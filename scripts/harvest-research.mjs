import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = resolve(rootDirectory, "content", "source-registry.json");
const defaultRadarPath = resolve(rootDirectory, "content", "research-radar.json");
const inboxDirectory = resolve(rootDirectory, "content", "inbox");
const argumentsByName = parseArguments(process.argv.slice(2));
const days = Number.parseInt(argumentsByName.get("days") ?? "7", 10);
const limit = Number.parseInt(argumentsByName.get("limit") ?? "100", 10);
const outputPath = resolve(rootDirectory, argumentsByName.get("output") ?? "content/research-radar.json");
const query = argumentsByName.get("query")?.trim() ?? "";

if (!Number.isInteger(days) || days < 1 || days > 90) {
  throw new Error("--days must be an integer from 1 to 90.");
}

if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
  throw new Error("--limit must be an integer from 1 to 200.");
}

const range = resolveDateRange(argumentsByName, days);
const registry = await readJson(registryPath);
const existingRadar = await readJsonIfPresent(outputPath, createEmptyRadar());
const generatedAt = new Date().toISOString();
const pubmedResult = await collectPubMedMetadata(registry.pubmed.journals, range, query, limit);
const rssResult = await collectRssMetadata(registry.rssFeeds ?? [], range, Math.min(limit, 50));
const existingItemsById = new Map((existingRadar.items ?? []).map((item) => [item.id, item]));
const discoveredItems = deduplicateRadarItems([...pubmedResult.articles, ...rssResult.articles])
  .map((article) => mergeWithExisting(article, existingItemsById.get(article.id), generatedAt));
const discoveredIds = new Set(discoveredItems.map((item) => item.id));
const retainedItems = (existingRadar.items ?? []).filter((item) => !discoveredIds.has(item.id));
const allItems = [...discoveredItems, ...retainedItems]
  .sort((left, right) => dateValue(right.discoveredAt) - dateValue(left.discoveredAt));
const sourceStatus = [
  {
    id: "pubmed-journal-index",
    label: registry.pubmed.label,
    status: "ok",
    checkedAt: generatedAt,
    itemCount: pubmedResult.articles.length,
    detail: query ? `Additional query: ${query}` : "All configured journal sources"
  },
  ...rssResult.sourceStatus
];
const collectionHistory = [
  {
    collectedAt: generatedAt,
    coverage: range,
    query: query || null,
    discoveredCount: discoveredItems.length,
    totalArchivedCount: allItems.length,
    discoveredItemIds: [...discoveredIds],
    sources: sourceStatus.map((source) => ({
      id: source.id,
      label: source.label,
      status: source.status,
      itemCount: source.itemCount ?? 0
    }))
  },
  ...(existingRadar.collectionHistory ?? [])
].sort((left, right) => right.collectedAt.localeCompare(left.collectedAt));

const radar = {
  schemaVersion: 1,
  lastCollectedAt: generatedAt,
  coverage: range,
  sourceStatus,
  trendSignals: buildTrendSignals(discoveredItems),
  collectionHistory,
  items: allItems
};

await mkdir(dirname(outputPath), { recursive: true });
await writeJson(outputPath, radar);
if (outputPath === defaultRadarPath) await import("./build-knowledge-index.mjs");

if (!argumentsByName.has("no-inbox")) {
  await mkdir(inboxDirectory, { recursive: true });
  const inboxPath = resolve(inboxDirectory, `research-${range.from}-to-${range.to}.json`);
  await writeJson(inboxPath, {
    generatedAt,
    coverage: range,
    query: query || null,
    pubmedSearchTerm: pubmedResult.searchTerm,
    articleCount: discoveredItems.length,
    articles: discoveredItems
  });
}

console.log(`Collected ${pubmedResult.articles.length} PubMed and ${rssResult.articles.length} official-feed records for ${range.from} to ${range.to}.`);
console.log(`Updated ${outputPath}`);

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

function resolveDateRange(parsedArguments, dayCount) {
  const from = parsedArguments.get("from");
  const to = parsedArguments.get("to");

  if (from || to) {
    if (!isDate(from) || !isDate(to)) {
      throw new Error("--from and --to must both use the YYYY-MM-DD format.");
    }

    if (from > to) {
      throw new Error("--from must be on or before --to.");
    }

    return { from, to };
  }

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (dayCount - 1));
  return {
    from: formatIsoDate(startDate),
    to: formatIsoDate(endDate)
  };
}

async function collectPubMedMetadata(journals, range, additionalQuery, maximumResults) {
  const journalClause = `(${journals.map((journal) => `\"${journal.pubmedJournal}\"[jour]`).join(" OR ")})`;
  const topicClause = additionalQuery ? ` AND (${additionalQuery})` : "";
  const dateClause = ` AND (\"${range.from}\"[pdat] : \"${range.to}\"[pdat])`;
  const searchTerm = `${journalClause}${topicClause}${dateClause}`;
  const searchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi");
  searchUrl.searchParams.set("db", "pubmed");
  searchUrl.searchParams.set("retmode", "json");
  searchUrl.searchParams.set("retmax", String(maximumResults));
  searchUrl.searchParams.set("sort", "pub date");
  searchUrl.searchParams.set("term", searchTerm);

  const searchPayload = await fetchJson(searchUrl);
  const ids = searchPayload.esearchresult?.idlist ?? [];
  if (ids.length === 0) {
    return { articles: [], searchTerm };
  }

  const summaryUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi");
  summaryUrl.searchParams.set("db", "pubmed");
  summaryUrl.searchParams.set("retmode", "json");
  summaryUrl.searchParams.set("id", ids.join(","));
  const summaryPayload = await fetchJson(summaryUrl);
  const articles = ids
    .map((articleId) => toRadarItem(summaryPayload.result?.[articleId], articleId, journals))
    .filter(Boolean);

  return { articles, searchTerm };
}

function toRadarItem(article, articleId, journals) {
  if (!article) {
    return null;
  }

  const doi = article.articleids?.find((identifier) => identifier.idtype === "doi")?.value
    ?? article.elocationid?.replace(/^doi:\s*/i, "")
    ?? null;
  const pmcId = article.articleids?.find((identifier) => identifier.idtype === "pmc")?.value ?? null;
  const matchingJournal = journals.find((journal) => journal.pubmedJournal === article.source);
  const sourceUrl = doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${articleId}/`;
  const classificationText = `${article.title ?? ""} ${article.fulljournalname ?? ""}`;
  const issueDate = normaliseDate(article.pubdate);
  const onlinePublicationDate = normaliseDate(article.epubdate);

  return {
    id: `pmid-${articleId}`,
    status: "discovered",
    sourceType: "journal-article",
    sourceId: matchingJournal?.id ?? "unmapped-pubmed-journal",
    journal: article.fulljournalname ?? matchingJournal?.name ?? article.source ?? "Unknown journal",
    journalAbbreviation: article.source ?? matchingJournal?.abbreviation ?? "",
    journalUrl: matchingJournal?.officialUrl ?? null,
    title: article.title ?? "Untitled",
    publicationDate: onlinePublicationDate ?? issueDate ?? article.pubdate ?? "Unknown date",
    issueDate: issueDate && issueDate !== onlinePublicationDate ? issueDate : null,
    authors: (article.authors ?? []).map((author) => author.name).filter(Boolean),
    publicationTypes: asArray(article.pubtype).map((type) => normaliseText(toText(type))).filter(Boolean),
    doi,
    pmid: articleId,
    pmcId,
    sourceUrl,
    fullTextUrl: pmcId ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcId}/` : null,
    access: pmcId ? "pmc-record-available" : "check-publisher-or-institution",
    themes: classifyThemes(classificationText),
    sportTags: classifySports(classificationText),
    review: null,
    visualization: null
  };
}

async function collectRssMetadata(feeds, range, maximumResults) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false
  });
  const articles = [];
  const sourceStatus = [];

  for (const feed of feeds) {
    try {
      const feedText = await fetchText(feed.feedUrl);
      const parsedFeed = parser.parse(feedText);
      const feedItems = getFeedItems(parsedFeed)
        .map((item) => toRssRadarItem(item, feed))
        .filter(Boolean)
        .filter((item) => isWithinDateRange(item.publicationDate, range))
        .slice(0, maximumResults);

      articles.push(...feedItems);
      sourceStatus.push({
        id: feed.id,
        label: feed.label,
        status: "ok",
        checkedAt: new Date().toISOString(),
        itemCount: feedItems.length,
        detail: feed.focus
      });
    } catch (error) {
      sourceStatus.push({
        id: feed.id,
        label: feed.label,
        status: "error",
        checkedAt: new Date().toISOString(),
        itemCount: 0,
        detail: `Could not read this official feed: ${error.message}`
      });
    }
  }

  return { articles, sourceStatus };
}

function getFeedItems(parsedFeed) {
  return asArray(parsedFeed?.rss?.channel?.item ?? parsedFeed?.RDF?.item ?? parsedFeed?.feed?.entry);
}

function toRssRadarItem(item, feed) {
  const title = normaliseText(readFeedValue(item, ["title", "name"]));
  if (!title) {
    return null;
  }

  const identifiers = asArray(item.identifier).map((identifier) => toText(identifier));
  const doi = identifiers.map(extractDoi).find(Boolean) ?? extractDoi(title);
  const sourceUrl = normaliseExternalUrl(readFeedValue(item, ["link", "id"])) ?? feed.officialUrl;
  const publicationDate = normaliseDate(readFeedValue(item, ["date", "publicationDate", "pubDate", "published", "updated"])) ?? "Date unavailable";
  const classificationText = `${title} ${readFeedValue(item, ["section", "subject", "category"]) ?? ""}`;

  return {
    id: `rss-${feed.id}-${createHash("sha256").update(doi ?? sourceUrl ?? title).digest("hex").slice(0, 16)}`,
    status: "discovered",
    sourceType: "official-update",
    sourceId: feed.id,
    journal: feed.label,
    journalAbbreviation: "",
    journalUrl: feed.officialUrl,
    title,
    publicationDate,
    authors: splitAuthors(readFeedValue(item, ["creator", "author"])),
    doi,
    pmid: null,
    pmcId: null,
    sourceUrl,
    fullTextUrl: null,
    access: "official-source",
    contentKind: normaliseText(readFeedValue(item, ["section", "subject", "category"])) ?? "Official update",
    themes: classifyThemes(classificationText),
    sportTags: classifySports(classificationText),
    review: null,
    visualization: null
  };
}

function deduplicateRadarItems(items) {
  const itemsByIdentity = new Map();

  for (const item of items) {
    const identity = item.doi
      ? `doi:${item.doi.toLowerCase()}`
      : item.pmid
        ? `pmid:${item.pmid}`
        : `url:${item.sourceUrl}`;
    const existingItem = itemsByIdentity.get(identity);

    if (!existingItem || existingItem.sourceType !== "journal-article") {
      itemsByIdentity.set(identity, item);
    }
  }

  return [...itemsByIdentity.values()];
}

function mergeWithExisting(article, existingItem, generatedAt) {
  if (!existingItem) {
    return { ...article, discoveredAt: generatedAt };
  }

  return {
    ...article,
    discoveredAt: existingItem.discoveredAt ?? generatedAt,
    status: existingItem.status ?? article.status,
    review: existingItem.review ?? null,
    visualization: existingItem.visualization ?? null,
    featuredInIssueId: existingItem.featuredInIssueId ?? null
  };
}

function buildTrendSignals(items) {
  const counts = new Map();
  for (const item of items) {
    for (const theme of item.themes) {
      counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-Hant"))
    .slice(0, 6)
    .map(([label, count]) => ({
      label,
      count,
      basis: "題名與期刊 metadata 的受控關鍵詞訊號；不代表療效、證據品質或臨床建議。"
    }));
}

function classifyThemes(text) {
  const normalizedText = text.toLowerCase();
  const taxonomy = [
    ["ACL / 膝關節", /anterior cruciate|\bacl\b|knee/],
    ["肩與上肢", /shoulder|elbow|rotator cuff|upper extremity/],
    ["足踝", /ankle|achilles|foot/],
    ["腦震盪", /concussion|brain injur/],
    ["訓練負荷", /training load|workload|load monitor|periodi[sz]ation/],
    ["肌力與爆發力", /strength|resistance training|power|plyometric/],
    ["營養與水合", /nutrition|diet|hydration|fluid|carbohydrate|protein/],
    ["恢復與睡眠", /recovery|sleep|fatigue|readiness/],
    ["熱環境", /heat|thermal|thermoregulation|hot environment/],
    ["量測與科技", /wearable|force plate|biomechanic|monitoring|technology|sensor/],
    ["女性運動員健康", /female athlete|women athlete|menstrual|pregnan/],
    ["兒童與青少年", /child|pediatric|paediatric|adolescen|youth|young athlete/],
    ["運動心臟與健康", /cardiac|cardiovascular|heart|exercise prescription|physical activity/],
    ["心理與神經認知", /psycholog|mental health|psychiatr|cogniti|neuro/],
    ["運動傷害預防", /injury prevention|risk factor|screening|surveillance/],
    ["回場與復健", /return to sport|return-to-sport|rehabilitation|recovery after surgery/],
    ["反禁藥與藥理", /anti-doping|doping|prohibited|pharmacolog/]
  ];

  return taxonomy.filter(([, pattern]) => pattern.test(normalizedText)).map(([label]) => label);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "edge-sport-evidence-weekly/0.2 (metadata-only research radar)"
    }
  });

  if (!response.ok) {
    throw new Error(`PubMed request failed with ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "edge-sport-evidence-weekly/0.2 (official-source research radar)"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function createEmptyRadar() {
  return {
    schemaVersion: 1,
    lastCollectedAt: null,
    coverage: { from: null, to: null },
    sourceStatus: [],
    trendSignals: [],
    collectionHistory: [],
    items: []
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonIfPresent(path, fallback) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readFeedValue(item, keys) {
  for (const key of keys) {
    if (item?.[key] !== undefined) {
      const value = toText(item[key]);
      if (value) {
        return value;
      }
    }
  }

  return null;
}

function toText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toText(entry)).filter(Boolean).join("; ");
  }

  if (value && typeof value === "object") {
    const directValue = value.href ?? value["#text"] ?? value.text;
    if (directValue) {
      return String(directValue);
    }

    return Object.values(value).map((entry) => toText(entry)).filter(Boolean).join("; ");
  }

  return "";
}

function normaliseText(value) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text || null;
}

function normaliseDate(value) {
  const text = normaliseText(value);
  if (!text) {
    return null;
  }

  const directDate = text.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (directDate) {
    return `${directDate[1]}-${directDate[2]}-${directDate[3]}`;
  }

  const parsedDate = new Date(text);
  return Number.isNaN(parsedDate.valueOf()) ? text : formatIsoDate(parsedDate);
}

function normaliseExternalUrl(value) {
  const text = normaliseText(value);
  if (!text) {
    return null;
  }

  try {
    const parsedUrl = new URL(text);
    if (parsedUrl.protocol === "http:") {
      parsedUrl.protocol = "https:";
    }
    return parsedUrl.protocol === "https:" ? parsedUrl.href : null;
  } catch {
    return null;
  }
}

function extractDoi(value) {
  const matchedDoi = String(value ?? "").match(/10\.\d{4,9}\/[\w.()/:;-]+/i);
  return matchedDoi?.[0] ?? null;
}

function splitAuthors(value) {
  return normaliseText(value)?.split(/;|,\s*(?=[A-Z][a-z-]+\s)/).map((author) => author.trim()).filter(Boolean) ?? [];
}

function isWithinDateRange(value, range) {
  return !/^\d{4}-\d{2}-\d{2}$/.test(value) || (value >= range.from && value <= range.to);
}

function dateValue(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function classifySports(text) {
  const normalizedText = text.toLowerCase();
  const taxonomy = [
    ["足球", /soccer|association football|football player/],
    ["籃球", /basketball/],
    ["棒球", /baseball|pitcher|pitching/],
    ["跑步與田徑", /running|runner|marathon|track and field|sprinter|jumping|throwing athlete/],
    ["自行車", /cycling|cyclist|mountain bik/],
    ["游泳與水上運動", /swim|aquatic|water polo|rowing/],
    ["網球與拍類", /tennis|badminton|racket|racquet|table tennis/],
    ["技擊運動", /boxing|martial art|combat sport|taekwondo|judo|wrestl/],
    ["高爾夫", /golf/],
    ["排球", /volleyball/],
    ["橄欖球與美式足球", /rugby|american football|national football league|\bnfl\b/],
    ["冬季運動", /ski|snowboard|ice hockey|winter sport/],
    ["帕拉運動", /para sport|paralymp|wheelchair/],
    ["肌力與體能", /weightlifting|powerlifting|resistance training|strength training|crossfit/]
  ];

  return taxonomy.filter(([, pattern]) => pattern.test(normalizedText)).map(([label]) => label);
}
