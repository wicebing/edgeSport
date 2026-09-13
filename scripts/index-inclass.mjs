import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRelevantExcerpt, identifyConcepts, normaliseWhitespace } from "./lib/knowledge-matching.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inClassDirectory = resolve(rootDirectory, "inClass");
const defaultOutputPath = resolve(rootDirectory, "research-library", "inclass-index.json");
const argumentsByName = parseArguments(process.argv.slice(2));
const outputPath = resolve(rootDirectory, argumentsByName.get("output") ?? "research-library/inclass-index.json");
const maximumDocumentCharacters = Number.parseInt(argumentsByName.get("max-characters") ?? "40000", 10);

if (!Number.isInteger(maximumDocumentCharacters) || maximumDocumentCharacters < 4000) {
  throw new Error("--max-characters must be an integer of at least 4000.");
}

const sourceFiles = await collectSourceFiles(inClassDirectory);
const documents = await createCourseDocuments(sourceFiles, maximumDocumentCharacters);
const index = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  root: "inClass",
  sourceFileCount: sourceFiles.length,
  documentCount: documents.length,
  documents
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Indexed ${documents.length} inClass course modules from ${sourceFiles.length} converted source files.`);
console.log(`Private index: ${outputPath}`);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryPath));
    } else if (entry.isFile() && (entry.name.endsWith("_output.md") || entry.name.endsWith(".txt"))) {
      files.push(entryPath);
    }
  }

  return files;
}

async function createCourseDocuments(files, maximumCharacters) {
  const filesByDirectory = new Map();
  for (const filePath of files) {
    const directory = dirname(filePath);
    const knownFiles = filesByDirectory.get(directory) ?? [];
    knownFiles.push(filePath);
    filesByDirectory.set(directory, knownFiles);
  }

  const documents = [];
  for (const [directory, groupFiles] of filesByDirectory) {
    const markdownFiles = groupFiles.filter((filePath) => filePath.endsWith("_output.md"));
    const selectedFiles = markdownFiles.length > 0 ? markdownFiles : groupFiles.filter((filePath) => filePath.endsWith(".txt"));
    const rawCombinedText = (await Promise.all(selectedFiles.map((filePath) => readFile(filePath, "utf8")))).join("\n\n");
    const combinedText = normaliseWhitespace(rawCombinedText);
    const courseTitle = basename(directory);
    const headings = extractHeadings(rawCombinedText);
    const concepts = identifyConcepts(courseTitle, combinedText);
    const relativeDirectory = relative(rootDirectory, directory).replaceAll("\\", "/");
    const sourceRelativePaths = selectedFiles.map((filePath) => relative(rootDirectory, filePath).replaceAll("\\", "/"));

    documents.push({
      id: `course-${createHash("sha256").update(relativeDirectory).digest("hex").slice(0, 16)}`,
      title: courseTitle,
      relativePath: relativeDirectory,
      sourceFiles: sourceRelativePaths,
      headings,
      conceptIds: concepts.map((concept) => concept.id),
      conceptLabels: concepts.map((concept) => concept.label),
      characterCount: combinedText.length,
      excerpt: extractRelevantExcerpt(combinedText, courseTitle, 1800),
      text: combinedText.slice(0, maximumCharacters)
    });
  }

  return documents.sort((left, right) => left.title.localeCompare(right.title, "zh-Hant"));
}

function extractHeadings(text) {
  return [...text.matchAll(/^#{1,4}\s+(.+)$/gmu)]
    .map((match) => normaliseWhitespace(match[1]))
    .filter(Boolean)
    .slice(0, 18);
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