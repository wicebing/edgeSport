import { access, readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsByName = parseArguments(process.argv.slice(2));
const incomingDirectory = resolve(rootDirectory, argumentsByName.get("dir") ?? "research-library/incoming");
const reviewer = argumentsByName.get("reviewer") ?? "";
const radar = JSON.parse(await readFile(resolve(rootDirectory, "content", "research-radar.json"), "utf8"));
const records = radar.items ?? [];

if (!await pathExists(incomingDirectory)) {
  console.log(`No incoming PDF folder yet: ${incomingDirectory}`);
  console.log("Create it and name files with a PMID, for example pmid-42706652.pdf.");
  process.exit(0);
}

const files = (await readdir(incomingDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name).toLocaleLowerCase("en") === ".pdf")
  .map((entry) => resolve(incomingDirectory, entry.name));

let imported = 0;
let skipped = 0;
let unmatched = 0;

for (const pdfPath of files) {
  const record = matchRecord(pdfPath, records);
  if (!record) {
    unmatched += 1;
    console.log(`Could not match a radar record: ${basename(pdfPath)}`);
    continue;
  }

  const reviewPath = resolve(rootDirectory, "research-library", "reviews", `${record.id}.json`);
  if (await pathExists(reviewPath) && !argumentsByName.has("overwrite")) {
    skipped += 1;
    console.log(`Review input already prepared: ${record.id}`);
    continue;
  }

  const childArguments = [
    resolve(rootDirectory, "scripts", "prepare-full-text-review.mjs"),
    "--id", record.id,
    "--pdf", pdfPath
  ];
  if (reviewer) childArguments.push("--reviewer", reviewer);
  if (argumentsByName.has("overwrite")) childArguments.push("--overwrite");
  const exitCode = await runProcess(process.execPath, childArguments);
  if (exitCode !== 0) {
    throw new Error(`Could not prepare ${basename(pdfPath)} for ${record.id}.`);
  }
  imported += 1;
}

console.log(`PDF intake complete: ${imported} imported, ${skipped} already prepared, ${unmatched} unmatched.`);

function matchRecord(path, candidates) {
  const fileName = basename(path, extname(path));
  const pmid = fileName.match(/(?:^|[^a-z0-9])pmid[-_ ]?(\d{5,})(?:[^0-9]|$)/iu)?.[1]
    ?? fileName.match(/^(\d{5,})(?:[^0-9]|$)/u)?.[1];
  if (pmid) {
    return candidates.find((record) => record.pmid === pmid || record.id === `pmid-${pmid}`) ?? null;
  }

  const normalizedName = normalizeIdentifier(fileName);
  return candidates.find((record) => record.doi && normalizedName.includes(normalizeIdentifier(record.doi))) ?? null;
}

function normalizeIdentifier(value) {
  return String(value).toLocaleLowerCase("en").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function runProcess(command, argumentsList) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, argumentsList, {
      cwd: rootDirectory,
      shell: false,
      windowsHide: true,
      stdio: "inherit"
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
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
