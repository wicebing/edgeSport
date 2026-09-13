import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractArticleFromHtml } from "./lib/article-html-extraction.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsByName = parseArguments(process.argv.slice(2));
const reportId = argumentsByName.get("id");
const packetPath = resolve(rootDirectory, argumentsByName.get("packet") ?? `research-library/weekly-packets/${reportId ?? ""}.json`);
const webFullTextDirectory = resolve(rootDirectory, "research-library", "web-full-text");
const extractedDirectory = resolve(rootDirectory, "research-library", "extracted");
const resolverTemplate = argumentsByName.get("resolver") ?? process.env.EDGE_SPORT_LIBRARY_RESOLVER ?? "";
const requestTimeout = parsePositiveInteger(argumentsByName.get("timeout-seconds") ?? "35", "--timeout-seconds", 5, 180) * 1000;
const requestDelay = parsePositiveInteger(argumentsByName.get("delay-ms") ?? "350", "--delay-ms", 0, 10000);
const maximumArticles = parsePositiveInteger(argumentsByName.get("limit") ?? "20", "--limit", 1, 100);
const maximumHtmlBytes = parsePositiveInteger(argumentsByName.get("max-html-mb") ?? "20", "--max-html-mb", 1, 100) * 1024 * 1024;

if (!reportId && !argumentsByName.get("packet")) {
  throw new Error("Provide --id YYYY-wNN or --packet path/to/packet.json.");
}

const packet = JSON.parse(await readFile(packetPath, "utf8"));
const packetArticles = [...(packet.selectedArticles ?? []), ...(packet.unavailableArticles ?? [])];
const articles = [...new Map(packetArticles.map((article) => [article.record?.id, article])).values()]
  .filter((article) => article.record?.id)
  .slice(0, maximumArticles);

await mkdir(webFullTextDirectory, { recursive: true });
await mkdir(extractedDirectory, { recursive: true });

let captured = 0;
let alreadyAvailable = 0;
let unresolved = 0;

for (const article of articles) {
  const record = article.record;
  const htmlPath = resolve(webFullTextDirectory, `${record.id}.html`);
  const auditPath = resolve(webFullTextDirectory, `${record.id}.json`);
  const textPath = resolve(extractedDirectory, `${record.id}.txt`);
  if (!argumentsByName.has("overwrite") && await pathExists(textPath)) {
    alreadyAvailable += 1;
    console.log(`Full text already available: ${record.id}`);
    continue;
  }

  const result = await fetchWebArticle(record);
  const audit = {
    schemaVersion: 1,
    recordId: record.id,
    doi: record.doi ?? null,
    retrievedAt: new Date().toISOString(),
    outcome: result.article?.ok ? "complete-web-full-text" : "not-automatically-accessible",
    resolvedUrl: result.article?.ok ? safeAuditUrl(result.resolvedUrl) : null,
    pageTitle: result.article?.title ?? null,
    metrics: result.article?.metrics ?? null,
    attempts: result.attempts,
    rightsRule: "Private institutional/open-web reading copy. Publish only original synthesis and original redraws unless reuse rights are separately verified."
  };

  if (result.article?.ok) {
    audit.sha256 = createHash("sha256").update(result.html).digest("hex");
    await Promise.all([
      writeFile(htmlPath, result.html, "utf8"),
      writeFile(textPath, `${result.article.text}\n`, "utf8"),
      writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8")
    ]);
    captured += 1;
    console.log(`Captured verified web full text: ${record.id} (${result.article.metrics.characterCount.toLocaleString()} characters, ${result.article.metrics.tableCount} tables)`);
  } else {
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    unresolved += 1;
    console.log(`No complete web full text detected: ${record.id}`);
  }
}

console.log(`Web full-text intake: ${captured} captured, ${alreadyAvailable} already available, ${unresolved} unresolved.`);
if (unresolved > 0) {
  console.log("Unresolved pages may require browser SSO/interaction or a PDF fallback; no access control was bypassed.");
}

async function fetchWebArticle(record) {
  const attempts = [];
  const cookieJar = new Map();
  const urls = createStartUrls(record);
  let best = null;

  for (const url of urls) {
    let response;
    try {
      response = await fetchFollowingRedirects(url, cookieJar);
    } catch (error) {
      attempts.push({ url: safeAuditUrl(url), outcome: "request-error", detail: cleanErrorMessage(error) });
      await delay(requestDelay);
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    const resolvedUrl = response.url || url;
    if (contentLength > maximumHtmlBytes) {
      attempts.push({ url: safeAuditUrl(url), finalUrl: safeAuditUrl(resolvedUrl), status: response.status, contentType, outcome: "too-large" });
      await response.body?.cancel();
      continue;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const isPdf = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
    const isHtml = /text\/html|application\/xhtml\+xml/iu.test(contentType) || bytes.subarray(0, 512).toString("utf8").includes("<html");
    if (bytes.length > maximumHtmlBytes) {
      attempts.push({ url: safeAuditUrl(url), finalUrl: safeAuditUrl(resolvedUrl), status: response.status, contentType, outcome: "too-large" });
      continue;
    }
    if (isPdf) {
      attempts.push({ url: safeAuditUrl(url), finalUrl: safeAuditUrl(resolvedUrl), status: response.status, contentType, outcome: "pdf-available-not-downloaded" });
      continue;
    }
    if (!response.ok || !isHtml) {
      attempts.push({ url: safeAuditUrl(url), finalUrl: safeAuditUrl(resolvedUrl), status: response.status, contentType, outcome: response.ok ? "not-html" : "http-error" });
      continue;
    }

    const html = bytes.toString("utf8");
    const article = extractArticleFromHtml(html, resolvedUrl);
    attempts.push({
      url: safeAuditUrl(url),
      finalUrl: safeAuditUrl(resolvedUrl),
      status: response.status,
      contentType,
      outcome: article.ok ? "verified-web-full-text" : article.reason,
      metrics: article.metrics
    });
    if (!best || article.metrics.characterCount > best.article.metrics.characterCount) {
      best = { article, html, resolvedUrl };
    }
    if (article.ok) return { article, html, resolvedUrl, attempts };
    await delay(requestDelay);
  }

  return { article: best?.article ?? null, html: best?.html ?? "", resolvedUrl: best?.resolvedUrl ?? null, attempts };
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
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
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
  const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
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

function applyResolver(targetUrl, template) {
  return template.includes("{url}") ? template.replaceAll("{url}", encodeURIComponent(targetUrl)) : `${template}${encodeURIComponent(targetUrl)}`;
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
