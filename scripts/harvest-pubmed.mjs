import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inboxDirectory = resolve(rootDirectory, "content", "inbox");
const argumentsByName = new Map();
const argumentsList = process.argv.slice(2);

for (let index = 0; index < argumentsList.length; index += 2) {
  const name = argumentsList[index];
  const value = argumentsList[index + 1];

  if (name?.startsWith("--") && value && !value.startsWith("--")) {
    argumentsByName.set(name.slice(2), value);
  }
}

const from = argumentsByName.get("from");
const to = argumentsByName.get("to");
const query = argumentsByName.get("query") ?? "";

if (!from || !to) {
  console.error("Usage: npm run journal:watch -- --from 2026-09-06 --to 2026-09-12 [--query \"ACL OR athlete monitoring\"]");
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error("--from and --to must use the format YYYY-MM-DD.");
  process.exit(1);
}

const journals = [
  "Am J Sports Med[jour]",
  "Br J Sports Med[jour]",
  "J Orthop Sports Phys Ther[jour]",
  "Sports Med[jour]",
  "Med Sci Sports Exerc[jour]",
  "Int J Sports Physiol Perform[jour]"
];
const journalClause = `(${journals.join(" OR ")})`;
const topicClause = query.trim() ? ` AND (${query.trim()})` : "";
const dateClause = ` AND (\"${from}\"[pdat] : \"${to}\"[pdat])`;
const term = `${journalClause}${topicClause}${dateClause}`;
const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
searchUrl.searchParams.set("db", "pubmed");
searchUrl.searchParams.set("retmode", "json");
searchUrl.searchParams.set("retmax", "100");
searchUrl.searchParams.set("sort", "pub date");
searchUrl.searchParams.set("term", term);

const searchResponse = await fetch(searchUrl, {
  headers: { "User-Agent": "edge-sport-evidence-weekly/0.1 (local research workflow)" }
});

if (!searchResponse.ok) {
  throw new Error(`PubMed search failed with ${searchResponse.status} ${searchResponse.statusText}`);
}

const searchPayload = await searchResponse.json();
const ids = searchPayload.esearchresult?.idlist ?? [];
let articles = [];

if (ids.length > 0) {
  const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("retmode", "json");
  summaryUrl.searchParams.set("id", ids.join(","));

  const summaryResponse = await fetch(summaryUrl, {
    headers: { "User-Agent": "edge-sport-evidence-weekly/0.1 (local research workflow)" }
  });

  if (!summaryResponse.ok) {
    throw new Error(`PubMed summary failed with ${summaryResponse.status} ${summaryResponse.statusText}`);
  }

  const summaryPayload = await summaryResponse.json();
  articles = ids.map((articleId) => {
    const article = summaryPayload.result?.[articleId];
    return {
      pmid: articleId,
      title: article?.title ?? "Untitled",
      journal: article?.fulljournalname ?? "Unknown journal",
      publicationDate: article?.pubdate ?? "Unknown date",
      authors: article?.authors?.map((author) => author.name) ?? [],
      doi: article?.elocationid?.startsWith("doi: ") ? article.elocationid.slice(5) : null,
      pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${articleId}/`
    };
  });
}

await mkdir(inboxDirectory, { recursive: true });
const outputPath = resolve(inboxDirectory, `pubmed-${from}-to-${to}.json`);
const result = {
  generatedAt: new Date().toISOString(),
  from,
  to,
  query: query || null,
  searchedJournals: journals,
  articleCount: articles.length,
  articles
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`Saved ${articles.length} PubMed records to ${outputPath}`);