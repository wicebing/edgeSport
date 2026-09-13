import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const radarPath = resolve(rootDirectory, "content", "research-radar.json");
const argumentsByName = parseArguments(process.argv.slice(2));
const requestedIds = String(argumentsByName.get("articles") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const maximumArticles = parsePositiveInteger(argumentsByName.get("limit") ?? "20", "--limit", 1, 100);
const overwrite = argumentsByName.has("overwrite");

const radar = JSON.parse(await readFile(radarPath, "utf8"));
const recordsById = new Map((radar.items ?? []).map((record) => [record.id, record]));
const candidates = requestedIds.length > 0
  ? requestedIds.map((id) => recordsById.get(id)).filter(Boolean)
  : (radar.items ?? []).filter((record) => record.pmcId).slice(0, maximumArticles);

const missingIds = requestedIds.filter((id) => !recordsById.has(id));
if (missingIds.length > 0) {
  throw new Error(`The research radar does not contain: ${missingIds.join(", ")}`);
}

const openAccessDirectory = resolve(rootDirectory, "research-library", "open-access");
const extractedDirectory = resolve(rootDirectory, "research-library", "extracted");
await mkdir(openAccessDirectory, { recursive: true });
await mkdir(extractedDirectory, { recursive: true });

let downloaded = 0;
let skipped = 0;
let unavailable = 0;

for (const record of candidates.slice(0, maximumArticles)) {
  if (!record?.pmcId) {
    unavailable += 1;
    console.log(`No PMCID: ${record?.id ?? "unknown"}`);
    continue;
  }

  const textPath = resolve(extractedDirectory, `${record.id}.txt`);
  const auditPath = resolve(openAccessDirectory, `${record.id}.json`);
  if (!overwrite && await fileExists(textPath)) {
    skipped += 1;
    console.log(`Already available: ${record.id}`);
    continue;
  }

  const openAccessResult = await fetchOpenAccessFullText(record);
  if (!openAccessResult) {
    unavailable += 1;
    console.log(`Not in the Europe PMC or NCBI BioC open-access full-text sets: ${record.id}`);
    continue;
  }

  const fullText = openAccessResult.fullText;
  if (fullText.length < 3000) {
    unavailable += 1;
    console.log(`Open full text was too short to use safely: ${record.id}`);
    continue;
  }

  const rawPath = resolve(openAccessDirectory, `${record.id}.${openAccessResult.extension}`);
  const audit = {
    schemaVersion: 1,
    recordId: record.id,
    pmcId: record.pmcId,
    retrievedAt: new Date().toISOString(),
    sourceUrl: openAccessResult.sourceUrl,
    sourceFormat: openAccessResult.sourceFormat,
    publicArticleUrl: record.fullTextUrl,
    licenseText: openAccessResult.licenseText || "License statement not parsed; use locally for review and verify reuse terms before publishing original media.",
    sha256: createHash("sha256").update(openAccessResult.raw).digest("hex"),
    extractedCharacterCount: fullText.length,
    rightsRule: "Private full-text input only. Publish original synthesis unless the specific license is manually verified."
  };

  await Promise.all([
    writeFile(rawPath, openAccessResult.raw, "utf8"),
    writeFile(textPath, `${fullText}\n`, "utf8"),
    writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8")
  ]);
  downloaded += 1;
  console.log(`Saved complete open-access text: ${record.id} (${fullText.length.toLocaleString()} characters)`);
}

console.log(`Open-access intake complete: ${downloaded} downloaded, ${skipped} already present, ${unavailable} unavailable.`);

async function fetchOpenAccessFullText(record) {
  const europePmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(record.pmcId)}/fullTextXML`;
  try {
    const europePmcResponse = await fetch(europePmcUrl, {
      headers: { "User-Agent": "edge-sport-evidence-weekly/1.0 (local full-text review)" },
      signal: AbortSignal.timeout(30000)
    });
    if (europePmcResponse.ok) {
      const xml = await europePmcResponse.text();
      return {
        raw: xml,
        extension: "xml",
        sourceFormat: "Europe PMC JATS XML",
        sourceUrl: europePmcUrl,
        fullText: extractReadableFullText(xml, record),
        licenseText: extractLicenseText(xml)
      };
    }
    if (europePmcResponse.status !== 404) {
      console.warn(`Europe PMC request failed for ${record.id}: ${europePmcResponse.status} ${europePmcResponse.statusText}; trying NCBI BioC.`);
    }
  } catch (error) {
    console.warn(`Europe PMC request failed for ${record.id}: ${error.message}; trying NCBI BioC.`);
  }

  const bioCUrl = `https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/${encodeURIComponent(record.pmcId)}/unicode`;
  let bioCResponse;
  try {
    bioCResponse = await fetch(bioCUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "edge-sport-evidence-weekly/1.0 (local full-text review)"
      },
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    console.warn(`NCBI BioC request failed for ${record.id}: ${error.message}`);
    return null;
  }
  const raw = await bioCResponse.text();
  if (!bioCResponse.ok || !/application\/json/iu.test(bioCResponse.headers.get("content-type") ?? "")) {
    return null;
  }

  try {
    const payload = JSON.parse(raw);
    const document = payload?.[0]?.documents?.[0];
    const passages = document?.passages ?? [];
    const passageText = passages.map((passage) => passage?.text?.trim()).filter(Boolean);
    if (passageText.length === 0) return null;
    const licenseText = document?.infons?.license
      ?? passages.find((passage) => passage?.infons?.license)?.infons?.license
      ?? "";
    return {
      raw,
      extension: "bioc.json",
      sourceFormat: "NCBI PMC Open Access BioC JSON",
      sourceUrl: bioCUrl,
      fullText: normaliseText([`TITLE\n${record.title}`, ...passageText].join("\n\n")),
      licenseText: normaliseText(licenseText).slice(0, 2000)
    };
  } catch {
    return null;
  }
}

function extractReadableFullText(xml, record) {
  const abstract = xml.match(/<abstract(?:\s[^>]*)?>([\s\S]*?)<\/abstract>/iu)?.[1] ?? "";
  const body = xml.match(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/iu)?.[1] ?? "";
  const back = xml.match(/<back(?:\s[^>]*)?>([\s\S]*?)<\/back>/iu)?.[1] ?? "";
  const readable = [
    `TITLE\n${record.title}`,
    abstract ? `ABSTRACT\n${xmlToText(abstract)}` : "",
    body ? `FULL TEXT\n${xmlToText(body)}` : "",
    back ? `BACK MATTER AND DECLARED LIMITATIONS\n${xmlToText(back)}` : ""
  ].filter(Boolean).join("\n\n");
  return normaliseText(readable);
}

function extractLicenseText(xml) {
  const licenseBlock = xml.match(/<license(?:\s[^>]*)?>([\s\S]*?)<\/license>/iu)?.[1] ?? "";
  return normaliseText(xmlToText(licenseBlock)).slice(0, 2000);
}

function xmlToText(value) {
  return decodeEntities(String(value)
    .replace(/<xref(?:\s[^>]*)?>[\s\S]*?<\/xref>/giu, " ")
    .replace(/<label(?:\s[^>]*)?>([\s\S]*?)<\/label>/giu, "$1. ")
    .replace(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/giu, "\n$1\n")
    .replace(/<p(?:\s[^>]*)?>/giu, "\n")
    .replace(/<\/p>/giu, "\n")
    .replace(/<[^>]+>/gu, " "));
}

function decodeEntities(value) {
  const named = new Map([
    ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", "\""], ["apos", "'"], ["nbsp", " "]
  ]);
  return value
    .replace(/&([a-z]+);/giu, (match, name) => named.get(name.toLowerCase()) ?? match)
    .replace(/&#(\d+);/gu, (_, codePoint) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/giu, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)));
}

function normaliseText(value) {
  return String(value).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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

function parsePositiveInteger(value, label, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

async function fileExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
