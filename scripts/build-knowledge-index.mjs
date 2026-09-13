import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKnowledgeIndex } from "./lib/knowledge-index.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(rootDirectory, "content", "knowledge-index.json");
const [content, weeklyReports, radar, podcasts] = await Promise.all([
  readJson("content/issues.json"),
  readJson("content/weekly-reports.json"),
  readJson("content/research-radar.json"),
  readJson("content/podcasts.json")
]);
const index = buildKnowledgeIndex({ content, weeklyReports, radar, podcasts });
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Built cumulative knowledge index with ${index.stats.total} records: ${outputPath}`);

async function readJson(path) {
  return JSON.parse(await readFile(resolve(rootDirectory, path), "utf8"));
}
