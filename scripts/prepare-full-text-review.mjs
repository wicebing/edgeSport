import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const radarPath = resolve(rootDirectory, "content", "research-radar.json");
const argumentsByName = parseArguments(process.argv.slice(2));
const recordId = argumentsByName.get("id");
const pdfArgument = argumentsByName.get("pdf");
const reviewer = argumentsByName.get("reviewer") ?? "";

if (!recordId || !pdfArgument) {
  console.error("Usage: npm run research:prepare-review -- --id pmid-123456 --pdf C:\\Research\\article.pdf [--reviewer \"Name\"] [--overwrite]");
  process.exit(1);
}

const radar = JSON.parse(await readFile(radarPath, "utf8"));
const record = radar.items?.find((item) => item.id === recordId);
if (!record) {
  throw new Error(`No research-radar item found for ${recordId}. Run research:harvest first.`);
}

const recordSlug = recordId.replace(/[^a-zA-Z0-9._-]/g, "-");
const privateDirectory = resolve(rootDirectory, "research-library");
const extractedDirectory = resolve(privateDirectory, "extracted");
const reviewDirectory = resolve(privateDirectory, "reviews");
const downloadsDirectory = resolve(privateDirectory, "downloads");
const extractedTextPath = resolve(extractedDirectory, `${recordSlug}.txt`);
const reviewPath = resolve(reviewDirectory, `${recordSlug}.json`);
const storedPdfPath = resolve(downloadsDirectory, `${recordSlug}.pdf`);

if (!argumentsByName.has("overwrite") && await pathExists(reviewPath)) {
  throw new Error(`A private review already exists at ${reviewPath}. Use --overwrite only when you intentionally want to replace it.`);
}

const pdfPath = resolve(process.cwd(), pdfArgument);
const pdfStats = await stat(pdfPath);
if (!pdfStats.isFile()) {
  throw new Error(`PDF path is not a file: ${pdfPath}`);
}

const pdfBuffer = await readFile(pdfPath);
const pdfHash = createHash("sha256").update(pdfBuffer).digest("hex");
const parser = new PDFParse({ data: pdfBuffer });
let documentInfo;
let textResult;

try {
  documentInfo = await parser.getInfo({ parsePageInfo: false });
  textResult = await parser.getText();
} finally {
  await parser.destroy();
}

const extractedText = textResult.text?.trim() ?? "";

await mkdir(extractedDirectory, { recursive: true });
await mkdir(reviewDirectory, { recursive: true });
await mkdir(downloadsDirectory, { recursive: true });
if (pdfPath.toLocaleLowerCase("en") !== storedPdfPath.toLocaleLowerCase("en")) {
  if (await pathExists(storedPdfPath)) {
    const existingHash = createHash("sha256").update(await readFile(storedPdfPath)).digest("hex");
    if (existingHash !== pdfHash && !argumentsByName.has("overwrite")) {
      throw new Error(`A different stored PDF already exists at ${storedPdfPath}. Use --overwrite only after checking the file.`);
    }
  }
  await copyFile(pdfPath, storedPdfPath);
}
await writeFile(extractedTextPath, `${extractedText}\n`, "utf8");

const reviewTemplate = {
  schemaVersion: 1,
  recordId: record.id,
  privateAudit: {
    preparedAt: new Date().toISOString(),
    pdfFileName: basename(pdfPath),
    sourcePath: storedPdfPath,
    originalSourcePath: pdfPath,
    sha256: pdfHash,
    pageCount: documentInfo.total ?? null,
    extractedTextPath: relativePathFromRoot(extractedTextPath),
    extractedCharacterCount: extractedText.length
  },
  review: {
    fullTextRead: false,
    reviewedBy: reviewer,
    reviewedAt: "",
    sections: {
      abstract: false,
      introduction: false,
      methods: false,
      results: false,
      discussion: false,
      limitations: false,
      tablesAndFigures: false,
      supplementaryMaterial: "not-available"
    },
    studyDesign: "",
    population: "",
    setting: "",
    summary: "",
    keyFindings: [],
    limitations: []
  },
  rights: {
    sourceAccess: "institutional-license",
    publicUse: "editor-created-summary-and-synthesis",
    originalMaterialReproduced: false
  },
  synthesisTable: {
    title: "",
    headers: [],
    rows: [],
    sourceNote: "以自己的文字重整研究發現；不得複製原始論文的表格、圖說或圖像。"
  },
  visualization: {
    type: "bar",
    title: "",
    caption: "",
    unit: "",
    data: [],
    sourceNote: "以本文結果製作的原創視覺化；標示單位、族群與比較條件。"
  }
};

await writeFile(reviewPath, `${JSON.stringify(reviewTemplate, null, 2)}\n`, "utf8");

console.log(`Extracted ${extractedText.length.toLocaleString()} characters from ${documentInfo.total ?? "unknown"} pages.`);
console.log(`Review template: ${reviewPath}`);
console.log("Read the full text and complete the review template before running research:publish-review.");

if (extractedText.length < 1000) {
  console.warn("Warning: little selectable text was extracted. Check whether this PDF is scanned or protected and review it visually before publication.");
}

function parseArguments(argumentsList) {
  const parsedArguments = new Map();

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument?.startsWith("--")) {
      continue;
    }

    const name = argument.slice(2);
    const nextArgument = argumentsList[index + 1];
    if (!nextArgument || nextArgument.startsWith("--")) {
      parsedArguments.set(name, "true");
      continue;
    }

    parsedArguments.set(name, nextArgument);
    index += 1;
  }

  return parsedArguments;
}

function relativePathFromRoot(path) {
  return path.slice(rootDirectory.length + 1).replaceAll("\\", "/");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
