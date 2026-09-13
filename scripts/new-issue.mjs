import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentPath = resolve(rootDirectory, "content", "issues.json");
const argumentsByName = new Map();
const argumentsList = process.argv.slice(2);

for (let index = 0; index < argumentsList.length; index += 2) {
  const name = argumentsList[index];
  const value = argumentsList[index + 1];

  if (name?.startsWith("--") && value && !value.startsWith("--")) {
    argumentsByName.set(name.slice(2), value);
  }
}

const id = argumentsByName.get("id");
const date = argumentsByName.get("date");
const title = argumentsByName.get("title");
const topic = argumentsByName.get("topic") ?? "monitoring";

if (!id || !date || !title) {
  console.error("Usage: npm run new:issue -- --id 2026-w38 --date 2026-09-19 --title \"Title\" [--topic monitoring]");
  process.exit(1);
}

if (!/^\d{4}-w\d{2}$/.test(id)) {
  console.error("--id must use the format YYYY-wNN, for example 2026-w38.");
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("--date must use the format YYYY-MM-DD.");
  process.exit(1);
}

const content = JSON.parse(await readFile(contentPath, "utf8"));
if (content.issues.some((issue) => issue.id === id)) {
  console.error(`An issue with id ${id} already exists.`);
  process.exit(1);
}

if (!content.topics.some((availableTopic) => availableTopic.id === topic)) {
  console.error(`Unknown topic '${topic}'. Available topics: ${content.topics.map((availableTopic) => availableTopic.id).join(", ")}`);
  process.exit(1);
}

const newIssue = {
  id,
  status: "draft",
  publishDate: date,
  weekLabel: id.replace("-w", " Week "),
  title,
  summary: "待補入本週核心問題、臨床或訓練情境，以及可落地的結論。",
  readingMinutes: 8,
  topicIds: [topic],
  sportTags: ["待補入運動項目"],
  coverImage: {
    src: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=1400&q=85",
    alt: "運動員在訓練中",
    credit: "Photo source: Unsplash"
  },
  question: "待補入這份週刊要解決的明確實務問題。",
  evidenceLens: "待補入研究設計、共識或臨床指引的證據脈絡。",
  takeaways: [],
  decisionPath: [],
  fieldChecklist: [],
  metrics: [],
  trend: {
    title: "期刊趨勢觀察",
    body: "待完成本週期刊與國際組織資料的整合。"
  },
  evidence: [],
  courseConnections: []
};

content.issues.unshift(newIssue);
await writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");

console.log(`Created draft ${id}. Complete its evidence and practical sections, change status to 'published', then run npm run validate.`);