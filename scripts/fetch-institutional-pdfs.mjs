import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { derivePublisherPdfCandidates, extractPdfCandidates, isPdfPayload } from "./lib/article-pdf-discovery.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsByName = parseArguments(process.argv.slice(2));
const reportId = argumentsByName.get("id");
const packetPath = resolve(rootDirectory, argumentsByName.get("packet") ?? `research-library/weekly-packets/${reportId ?? ""}.json`);
const outputDirectory = resolve(rootDirectory, argumentsByName.get("output-dir") ?? "research-library/incoming");
const auditDirectory = resolve(rootDirectory, "research-library", "institutional-access");
const resolverTemplate = argumentsByName.get("resolver") ?? process.env.EDGE_SPORT_LIBRARY_RESOLVER ?? "";
const maximumBytes = parsePositiveInteger(argumentsByName.get("max-mb") ?? "60", "--max-mb", 1, 250) * 1024 * 1024;
const requestTimeout = parsePositiveInteger(argumentsByName.get("timeout-seconds") ?? "35", "--timeout-seconds", 5, 180) * 1000;
const requestDelay = parsePositiveInteger(argumentsByName.get("delay-ms") ?? "350", "--delay-ms", 0, 10000);
const maximumArticles = parsePositiveInteger(argumentsByName.get("limit") ?? "20", "--limit", 1, 100);

if (!reportId && !argumentsByName.get("packet")) {
  throw new Error("Provide --id YYYY-wNN or --packet path/to/packet.json.");
}

const packet = JSON.parse(await readFile(packetPath, "utf8"));
const packetArticles = [...(packet.selectedArticles ?? []), ...(packet.unavailableArticles ?? [])];
const articles = [...new Map(packetArticles.map((article) => [article.record?.id, article])).values()]
  .filter((article) => article.record?.id)
  .slice(0, maximumArticles);

await mkdir(outputDirectory, { recursive: true });
await mkdir(auditDirectory, { recursive: true });

const audit = {
  schemaVersion: 1,
  reportId: packet.id ?? reportId ?? null,
  attemptedAt: new Date().toISOString(),
  accessPolicy: "Authorized institutional/open-web access only; no access-control bypass.",
  resolverConfigured: Boolean(resolverTemplate),
  records: []
};

let downloaded = 0;
let alreadyAvailable = 0;
let unavailable = 0;

for (const article of articles) {
  const record = article.record;
  const existing = await findExistingFullText(record.id, outputDirectory);
  if (existing && !argumentsByName.has("overwrite")) {
    alreadyAvailable += 1;
    audit.records.push({ recordId: record.id, outcome: "already-available", path: relativePathFromRoot(existing), attempts: [] });
    console.log(`Already available: ${record.id}`);
    continue;
  }

  const result = await fetchArticlePdf(record);
  audit.records.push(result.auditRecord);
  if (result.pdf) {
    const outputPath = resolve(outputDirectory, `${record.id}-auto.pdf`);
    await writeFile(outputPath, result.pdf);
    downloaded += 1;
    result.auditRecord.path = relativePathFromRoot(outputPath);
    result.auditRecord.sha256 = createHash("sha256").update(result.pdf).digest("hex");
    result.auditRecord.bytes = result.pdf.length;
    console.log(`Downloaded verified PDF: ${record.id} (${formatBytes(result.pdf.length)})`);
  } else {
    unavailable += 1;
    console.log(`No automatically accessible PDF: ${record.id}`);
  }
}

const auditName = `${packet.id ?? reportId ?? "packet"}.json`;
const auditPath = resolve(auditDirectory, auditName);
await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

console.log(`Institutional/open-web PDF intake: ${downloaded} downloaded, ${alreadyAvailable} already available, ${unavailable} require fallback.`);
console.log(`Private access audit: ${auditPath}`);
if (unavailable > 0) {
  console.log("Fallback only for unresolved records: download the authorized PDF in your browser and place it in research-library/incoming with its pmid-<number> in the filename.");
}

async function fetchArticlePdf(record) {
  const attempts = [];
  const cookieJar = new Map();
  const queue = createStartUrls(record);
  const visited = new Set();

  while (queue.length > 0 && visited.size < 18) {
    const candidate = queue.shift();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);

    let response;
    try {
      response = await fetchFollowingRedirects(candidate, cookieJar);
    } catch (error) {
      attempts.push({ url: safeAuditUrl(candidate), outcome: "request-error", detail: cleanErrorMessage(error) });
      await delay(requestDelay);
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    const finalUrl = response.url || candidate;
    if (contentLength > maximumBytes) {
      attempts.push({ url: safeAuditUrl(candidate), finalUrl: safeAuditUrl(finalUrl), status: response.status, contentType, outcome: "too-large" });
      await response.body?.cancel();
      continue;
    }

    let bytes;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      attempts.push({ url: safeAuditUrl(candidate), finalUrl: safeAuditUrl(finalUrl), status: response.status, contentType, outcome: "read-error", detail: cleanErrorMessage(error) });
      continue;
    }

    if (bytes.length > maximumBytes) {
      attempts.push({ url: safeAuditUrl(candidate), finalUrl: safeAuditUrl(finalUrl), status: response.status, contentType, outcome: "too-large" });
      continue;
    }

    if (response.ok && isPdfPayload(bytes, contentType)) {
      attempts.push({ url: safeAuditUrl(candidate), finalUrl: safeAuditUrl(finalUrl), status: response.status, contentType, outcome: "verified-pdf" });
      return {
        pdf: bytes,
        auditRecord: {
          recordId: record.id,
          doi: record.doi ?? null,
          outcome: "downloaded",
          resolvedUrl: safeAuditUrl(finalUrl),
          attempts
        }
      };
    }

    const isHtml = /text\/html|application\/xhtml\+xml/iu.test(contentType) || bytes.subarray(0, 512).toString("utf8").includes("<html");
    attempts.push({
      url: safeAuditUrl(candidate),
      finalUrl: safeAuditUrl(finalUrl),
      status: response.status,
      contentType,
      outcome: response.ok ? (isHtml ? "landing-page" : "not-pdf") : "http-error"
    });

    if (isHtml) {
      const html = bytes.toString("utf8");
      const discovered = [
        ...(response.ok ? extractPdfCandidates(html, finalUrl) : []),
        ...derivePublisherPdfCandidates(finalUrl, record.doi)
      ];
      for (const url of discovered) {
        if (!visited.has(url) && !queue.includes(url)) queue.push(url);
      }
    }
    await delay(requestDelay);
  }

  return {
    pdf: null,
    auditRecord: { recordId: record.id, doi: record.doi ?? null, outcome: "not-automatically-accessible", attempts }
  };
}

function createStartUrls(record) {
  const directUrls = unique([
    record.fullTextUrl,
    record.sourceUrl,
    record.doi ? `https://doi.org/${record.doi}` : null
  ].filter(isHttpUrl));
  if (!resolverTemplate) return directUrls;
  return unique([...directUrls.map((url) => applyResolver(url, resolverTemplate)), ...directUrls]);
}

async function fetchFollowingRedirects(initialUrl, cookieJar) {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 8; redirectCount += 1) {
    const headers = {
      Accept: "application/pdf,text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      "Accept-Language": "en-US,en;q=0.8,zh-TW;q=0.7",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 EDGE-SPORT-evidence-weekly/0.4"
    };
    const cookieHeader = readCookies(cookieJar, currentUrl);
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(currentUrl, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeout)
    });
    storeCookies(cookieJar, currentUrl, response.headers);

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    await response.body?.cancel();
    currentUrl = new URL(location, currentUrl).href;
  }
  throw new Error("Too many redirects.");
}

function storeCookies(cookieJar, requestUrl, headers) {
  const hostname = new URL(requestUrl).hostname;
  const cookies = cookieJar.get(hostname) ?? new Map();
  const setCookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);
  for (const header of setCookies) {
    const pair = String(header).split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  if (cookies.size > 0) cookieJar.set(hostname, cookies);
}

function readCookies(cookieJar, targetUrl) {
  const cookies = cookieJar.get(new URL(targetUrl).hostname);
  return cookies ? [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ") : "";
}

async function findExistingFullText(recordId, incomingDirectory) {
  const knownPaths = [
    resolve(rootDirectory, "research-library", "downloads", `${recordId}.pdf`),
    resolve(rootDirectory, "research-library", "extracted", `${recordId}.txt`)
  ];
  for (const path of knownPaths) {
    if (await pathExists(path)) return path;
  }

  const files = await readdir(incomingDirectory, { withFileTypes: true });
  const normalizedId = recordId.toLocaleLowerCase("en");
  const match = files.find((entry) => entry.isFile()
    && entry.name.toLocaleLowerCase("en").endsWith(".pdf")
    && entry.name.toLocaleLowerCase("en").includes(normalizedId));
  return match ? resolve(incomingDirectory, match.name) : null;
}

function applyResolver(targetUrl, template) {
  return template.includes("{url}")
    ? template.replaceAll("{url}", encodeURIComponent(targetUrl))
    : `${template}${encodeURIComponent(targetUrl)}`;
}

function safeAuditUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|ticket|session|auth|key|code|saml|relaystate|signature/iu.test(key)) url.searchParams.set(key, "REDACTED");
    }
    url.hash = "";
    return url.href;
  } catch {
    return String(value ?? "");
  }
}

function cleanErrorMessage(error) {
  return String(error?.message ?? error ?? "request failed").slice(0, 300);
}

function isHttpUrl(value) {
  try {
    return /^https?:$/u.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relativePathFromRoot(path) {
  return path.startsWith(rootDirectory)
    ? path.slice(rootDirectory.length + 1).replaceAll("\\", "/")
    : basename(path);
}

function delay(milliseconds) {
  return milliseconds > 0 ? new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)) : Promise.resolve();
}

function parsePositiveInteger(value, label, minimum, maximum) {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsedValue;
}

function parseArguments(argumentsList) {
  const parsed = new Map();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument?.startsWith("--")) continue;
    const next = argumentsList[index + 1];
    if (!next || next.startsWith("--")) {
      parsed.set(argument.slice(2), "true");
    } else {
      parsed.set(argument.slice(2), next);
      index += 1;
    }
  }
  return parsed;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
