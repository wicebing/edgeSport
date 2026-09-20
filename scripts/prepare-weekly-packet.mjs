import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { extractRelevantExcerpt, normaliseWhitespace, rankKnowledgeMatches } from "./lib/knowledge-matching.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const radarPath = resolve(rootDirectory, "content", "research-radar.json");
const issuesPath = resolve(rootDirectory, "content", "issues.json");
const weeklyReportsPath = resolve(rootDirectory, "content", "weekly-reports.json");
const inClassIndexPath = resolve(rootDirectory, "research-library", "inclass-index.json");
const argumentsByName = parseArguments(process.argv.slice(2));
const reportId = argumentsByName.get("id");
const requestedTitle = argumentsByName.get("title")?.trim() || null;
const publishDate = argumentsByName.get("date") ?? formatIsoDate(new Date());
const maximumArticles = parsePositiveInteger(argumentsByName.get("max-articles") ?? "8", "--max-articles", 1, 52);
const maximumCourseMatches = parsePositiveInteger(argumentsByName.get("max-course-matches") ?? "3", "--max-course-matches", 1, 6);
const maximumPriorMatches = parsePositiveInteger(argumentsByName.get("max-prior-matches") ?? "3", "--max-prior-matches", 1, 6);
const outputDirectory = resolve(rootDirectory, argumentsByName.get("output-dir") ?? "research-library/weekly-packets");
const requestedRecordIds = parseCommaSeparatedValues(argumentsByName.get("articles"));
const requestedTheme = argumentsByName.get("theme")?.trim() ?? "";
const fullTextOnly = argumentsByName.has("full-text-only");

if (!reportId || !/^\d{4}-w\d{2}$/.test(reportId)) {
  throw new Error("--id must use YYYY-wNN, for example 2026-w38.");
}

if (!isDate(publishDate)) {
  throw new Error("--date must use YYYY-MM-DD.");
}

if (requestedRecordIds.length === 0 && !argumentsByName.has("all") && !requestedTheme) {
  throw new Error("Choose articles with --articles pmid-...,pmid-..., or use --all or --theme.");
}

const [radar, issues, weeklyReports, inClassIndex] = await Promise.all([
  readJson(radarPath),
  readJson(issuesPath),
  readJson(weeklyReportsPath),
  readRequiredJson(inClassIndexPath, "Run npm run inclass:index before preparing a weekly report.")
]);
const previouslyReportedRecordIds = new Set((weeklyReports.reports ?? [])
  .filter((report) => report.status === "published")
  .flatMap((report) => report.sourceRecordIds ?? []));
const selectedRecords = await selectResearchRecords(radar.items ?? []);
const abstractByRecordId = await fetchPubMedAbstracts(selectedRecords);
const priorIssueCandidates = createPriorIssueCandidates(issues.issues ?? [], weeklyReports.reports ?? []);
const packetBuild = await buildPacketArticles(selectedRecords, abstractByRecordId, inClassIndex.documents ?? [], priorIssueCandidates);

if (packetBuild.selectedArticles.length === 0) {
  const guidance = fullTextOnly
    ? "No complete web/local/open-access full text matched the current-week selection. Connect the institutional network and rerun, choose another record, add an authorized fallback PDF named pmid-<number>.pdf, or explicitly use --allow-abstracts."
    : "None of the selected records include a verified web/local/open full text or a PubMed abstract. Choose another current-week record or add an authorized source.";
  throw new Error(guidance);
}

const packet = {
  schemaVersion: 1,
  id: reportId,
  title: requestedTitle,
  titleMode: requestedTitle ? "fixed" : "generated",
  publishDate,
  weekLabel: formatWeekLabel(reportId),
  generatedAt: new Date().toISOString(),
  selection: {
    requestedRecordIds,
    requestedTheme: requestedTheme || null,
    selectedRecordIds: packetBuild.selectedArticles.map((article) => article.record.id),
    unavailableRecordIds: packetBuild.unavailableArticles.map((article) => article.record.id),
    maxArticles: maximumArticles,
    fullTextOnly
  },
  selectedArticles: packetBuild.selectedArticles,
  unavailableArticles: packetBuild.unavailableArticles,
  courseDocuments: packetBuild.courseDocuments,
  priorIssues: packetBuild.priorIssues,
  authoringRules: [
    "只根據此研究包提供的資料撰寫；不要補上未出現在來源中的數字、研究結果、受試者特徵或因果結論。",
    "contentLevel 為 full-text-web、full-text-local 或 full-text-open 時，必須先閱讀完整附件（含方法、結果、限制、表格與圖說）；contentLevel 為 abstract-only 時，只能整理摘要明確陳述的目的、方法、結果與結論。",
    "每篇文章都要對照提供的 inClass 內容與既有週報。沒有直接相符時，使用 no-direct-match，說明邊界，不可強行建立關聯。",
    "每篇完整交代研究設計、族群、方法、比較、追蹤時間、量化結果與限制；數值必須保留單位、分母、時間點與不確定性，不可從圖像目測估值。",
    "若任一來源明載至少兩個可直接比較的非負數值，週報至少建立一張原創長條圖，清楚交代族群、分母、比較方式與解讀邊界；若沒有合格數值就不強制作圖。",
    "週報必須從本週研究建立知識背景、重要名詞定義、證據趨勢與一個可執行實務方案，包含評估、分期、負荷、進退階、暫停或轉介條件及追蹤指標。",
    "實務方案逐項標示來源明載、inClass 支持、跨研究整合或 EDGE SPORT 操作提案；沒有被來源驗證的時間或門檻不得寫成通用標準。",
    "以自己的繁體中文重述資料。不得重製論文摘要、表格、圖說、圖像、PDF 或課程講義原文。",
    "所有實務意涵都要保留研究設計、族群、情境與限制；不要把單篇研究寫成普遍醫療或訓練處方。"
  ]
};

await mkdir(outputDirectory, { recursive: true });
const packetJsonPath = resolve(outputDirectory, `${reportId}.json`);
const packetMarkdownPath = resolve(outputDirectory, `${reportId}.md`);
await writeFile(packetJsonPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
await writeFile(packetMarkdownPath, renderPacketMarkdown(packet), "utf8");

console.log(`Prepared ${packet.selectedArticles.length} research sources for ${reportId}.`);
console.log(`Private packet: ${packetJsonPath}`);
console.log(`LLM-readable packet: ${packetMarkdownPath}`);
if (packet.unavailableArticles.length > 0) {
  console.log(`${packet.unavailableArticles.length} selected records were retained as metadata-only and excluded from synthesis.`);
}

async function selectResearchRecords(records) {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  let candidates;
  if (requestedRecordIds.length > 0) {
    const missingRecords = requestedRecordIds.filter((recordId) => !recordsById.has(recordId));
    if (missingRecords.length > 0) {
      throw new Error(`The research radar does not contain: ${missingRecords.join(", ")}`);
    }
    candidates = requestedRecordIds.map((recordId) => recordsById.get(recordId));
  } else {
    const normalizedTheme = requestedTheme.toLocaleLowerCase("zh-Hant");
    candidates = [...records]
      .filter((record) => isWithinCoverage(record.publicationDate, radar.coverage))
      .filter((record) => !previouslyReportedRecordIds.has(record.id))
      .filter((record) => !requestedTheme || (record.themes ?? []).some((theme) => theme.toLocaleLowerCase("zh-Hant").includes(normalizedTheme)))
      .filter((record) => !isLowValueEditorialRecord(record));
  }

  const scoredCandidates = [];
  for (const record of candidates) {
    const attachment = await getFullTextAttachment(record.id);
    const extractedTextPath = resolve(rootDirectory, "research-library", "extracted", `${record.id}.txt`);
    const hasCompleteFullText = Boolean(attachment) && await fileExists(extractedTextPath);
    if (fullTextOnly && !hasCompleteFullText) {
      continue;
    }
    scoredCandidates.push({
      record,
      score: researchPriority(record) + (hasCompleteFullText ? 1000 : 0)
    });
  }

  scoredCandidates.sort((left, right) => right.score - left.score || compareResearchRecords(left.record, right.record));
  return selectDiverseRecords(scoredCandidates.map((candidate) => candidate.record), maximumArticles);
}

function selectDiverseRecords(records, maximum) {
  const selected = [];
  const deferred = [];
  const seenSources = new Set();
  for (const record of records) {
    if (!seenSources.has(record.sourceId)) {
      selected.push(record);
      seenSources.add(record.sourceId);
    } else {
      deferred.push(record);
    }
    if (selected.length === maximum) return selected;
  }
  return [...selected, ...deferred].slice(0, maximum);
}

function researchPriority(record) {
  const text = `${record.title ?? ""} ${(record.publicationTypes ?? []).join(" ")}`.toLocaleLowerCase("en");
  let score = 0;
  if (/guideline|consensus|position statement/.test(text)) score += 90;
  if (/systematic review|meta-analysis|meta analysis/.test(text)) score += 80;
  if (/randomized|randomised|clinical trial/.test(text)) score += 60;
  if (/prospective|cohort|longitudinal/.test(text)) score += 35;
  if (/validation|reliability|diagnostic accuracy/.test(text)) score += 25;
  if (record.pmcId) score += 12;
  score += Math.min((record.themes ?? []).length * 3, 12);
  return score;
}

function isLowValueEditorialRecord(record) {
  const text = `${record.title ?? ""} ${(record.publicationTypes ?? []).join(" ")}`.toLocaleLowerCase("en");
  return /^(comment on|response to|reply to|corrigendum|erratum)|\b(letter|editorial|comment)\b/.test(text);
}

async function buildPacketArticles(records, abstractRecords, courseDocuments, priorIssueCandidates) {
  const selectedArticles = [];
  const unavailableArticles = [];
  const selectedCourses = new Map();
  const selectedPriorIssues = new Map();

  for (const record of records) {
    const abstractRecord = abstractRecords.get(record.id);
    const localFullText = await getLocalFullText(record.id);
    const abstractText = abstractRecord?.sections.map((section) => section.text).join("\n\n") ?? "";
    const sourceMaterial = createSourceMaterial(record, abstractRecord, localFullText);
    const matchingText = [record.title, abstractText, localFullText?.text.slice(0, 25000)].filter(Boolean).join("\n\n");
    const courseMatches = rankKnowledgeMatches(
      { title: record.title, abstract: abstractText, text: localFullText?.text ?? "", themes: record.themes },
      courseDocuments,
      { maximumMatches: maximumCourseMatches }
    ).map((match) => toCourseMatch(match, matchingText));
    const priorIssueMatches = rankKnowledgeMatches(
      { title: record.title, abstract: abstractText, text: localFullText?.text ?? "", themes: record.themes },
      priorIssueCandidates,
      { maximumMatches: maximumPriorMatches }
    ).map((match) => toPriorIssueMatch(match, matchingText));

    for (const match of courseMatches) {
      const course = courseDocuments.find((candidate) => candidate.id === match.courseDocumentId);
      if (course) {
        selectedCourses.set(course.id, {
          id: course.id,
          title: course.title,
          relativePath: course.relativePath,
          headings: course.headings,
          conceptLabels: course.conceptLabels
        });
      }
    }

    for (const match of priorIssueMatches) {
      const issue = priorIssueCandidates.find((candidate) => candidate.id === match.issueId);
      if (issue) {
        selectedPriorIssues.set(issue.id, {
          id: issue.id,
          title: issue.title,
          publishDate: issue.publishDate,
          topicIds: issue.topicIds,
          sportTags: issue.sportTags,
          kind: issue.kind
        });
      }
    }

    const article = {
      record: toPacketRecord(record),
      sourceMaterial,
      inClassMatches: courseMatches,
      priorIssueMatches
    };

    if (sourceMaterial.contentLevel === "metadata-only") {
      unavailableArticles.push(article);
    } else {
      selectedArticles.push(article);
    }
  }

  return {
    selectedArticles,
    unavailableArticles,
    courseDocuments: [...selectedCourses.values()],
    priorIssues: [...selectedPriorIssues.values()]
  };
}

function createSourceMaterial(record, abstractRecord, localFullText) {
  if (localFullText) {
    const contextText = [record.title, ...abstractRecord?.sections.map((section) => section.text) ?? []].join(" ");
    const contentLevel = localFullText.contentLevel ?? "full-text-excerpt";
    return {
      contentLevel,
      label: contentLevel === "full-text-web"
        ? "經學術網路取得並驗證結構的完整網頁全文"
        : contentLevel === "full-text-open"
        ? "開放取用的完整全文文字"
        : contentLevel === "full-text-local"
          ? "本機合法取得的完整全文文件"
          : "本機全文擷取的相關摘錄",
      attachmentPath: localFullText.attachmentPath,
      extractedTextPath: localFullText.relativePath,
      characterCount: localFullText.text.length,
      sourceExcerpt: extractRelevantExcerpt(localFullText.text, contextText, 5500),
      abstractSections: abstractRecord?.sections ?? [],
      publicationTypes: abstractRecord?.publicationTypes ?? []
    };
  }

  if (abstractRecord?.sections.length) {
    return {
      contentLevel: "abstract-only",
      label: "PubMed 摘要層級資料",
      attachmentPath: null,
      characterCount: abstractRecord.sections.reduce((total, section) => total + section.text.length, 0),
      sourceExcerpt: abstractRecord.sections.map((section) => `${section.label}: ${section.text}`).join("\n\n"),
      abstractSections: abstractRecord.sections,
      publicationTypes: abstractRecord.publicationTypes
    };
  }

  return {
    contentLevel: "metadata-only",
    label: "僅有書目 metadata，尚不可撰寫內容摘要",
    attachmentPath: null,
    characterCount: 0,
    sourceExcerpt: "",
    abstractSections: [],
    publicationTypes: []
  };
}

async function getLocalFullText(recordId) {
  const textPath = resolve(rootDirectory, "research-library", "extracted", `${recordId}.txt`);
  if (!await fileExists(textPath)) {
    return null;
  }

  const text = normaliseWhitespace(await readFile(textPath, "utf8"));
  if (!text) {
    return null;
  }

  return {
    relativePath: relativePathFromRoot(textPath),
    ...await getFullTextAttachment(recordId),
    text
  };
}

async function getFullTextAttachment(recordId) {
  const webTextPath = resolve(rootDirectory, "research-library", "extracted", `${recordId}.txt`);
  const webAuditPath = resolve(rootDirectory, "research-library", "web-full-text", `${recordId}.json`);
  if (await fileExists(webTextPath) && await fileExists(webAuditPath)) {
    const webAudit = await readJson(webAuditPath);
    if (webAudit?.outcome === "complete-web-full-text") {
      return { attachmentPath: webTextPath, contentLevel: "full-text-web" };
    }
  }

  const reviewPath = resolve(rootDirectory, "research-library", "reviews", `${recordId}.json`);
  try {
    const review = await readJson(reviewPath);
    const candidatePath = review?.privateAudit?.sourcePath;
    if (typeof candidatePath === "string" && await fileExists(candidatePath)) {
      return { attachmentPath: candidatePath, contentLevel: "full-text-local" };
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const downloadPath = resolve(rootDirectory, "research-library", "downloads", `${recordId}.pdf`);
  if (await fileExists(downloadPath)) {
    return { attachmentPath: downloadPath, contentLevel: "full-text-local" };
  }

  const openAccessPath = resolve(rootDirectory, "research-library", "extracted", `${recordId}.txt`);
  const openAccessAuditPath = resolve(rootDirectory, "research-library", "open-access", `${recordId}.json`);
  if (await fileExists(openAccessPath) && await fileExists(openAccessAuditPath)) {
    return { attachmentPath: openAccessPath, contentLevel: "full-text-open" };
  }

  return null;
}

async function fetchPubMedAbstracts(records) {
  const pmids = records.map((record) => record.pmid).filter(Boolean);
  if (pmids.length === 0) {
    return new Map();
  }

  const url = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", pmids.join(","));
  url.searchParams.set("retmode", "xml");
  const response = await fetch(url, {
    headers: { "User-Agent": "edge-sport-evidence-weekly/0.3 (local research packet)" }
  });

  if (!response.ok) {
    throw new Error(`PubMed abstract request failed with ${response.status} ${response.statusText}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: false
  });
  const payload = parser.parse(await response.text());
  const results = new Map();

  for (const article of asArray(payload?.PubmedArticleSet?.PubmedArticle)) {
    const citation = article?.MedlineCitation;
    const articleData = citation?.Article;
    const pmid = toText(citation?.PMID);
    if (!pmid) {
      continue;
    }

    const sections = asArray(articleData?.Abstract?.AbstractText)
      .map((section, index) => ({
        label: normaliseWhitespace(section?.Label ?? section?.NlmCategory ?? (index === 0 ? "ABSTRACT" : `SECTION ${index + 1}`)),
        text: decodeEntities(normaliseWhitespace(toText(section)))
      }))
      .filter((section) => section.text);
    const publicationTypes = asArray(articleData?.PublicationTypeList?.PublicationType)
      .map((publicationType) => normaliseWhitespace(toText(publicationType)))
      .filter(Boolean);
    results.set(`pmid-${pmid}`, { sections, publicationTypes });
  }

  return results;
}

function createPriorIssueCandidates(issues, reports) {
  const curatedIssues = issues
    .filter((issue) => issue.status === "published")
    .map((issue) => ({
      id: issue.id,
      kind: "curated-issue",
      title: issue.title,
      summary: issue.summary,
      publishDate: issue.publishDate,
      topicIds: issue.topicIds,
      sportTags: issue.sportTags,
      excerpt: normaliseWhitespace([
        issue.question,
        ...(issue.takeaways ?? []).map((takeaway) => `${takeaway.title}: ${takeaway.body}`),
        ...(issue.metrics ?? []).map((metric) => `${metric.name}: ${metric.practice}`),
        issue.trend?.body
      ].filter(Boolean).join("\n"))
    }));

  const integratedReports = reports
    .filter((report) => report.status === "published" && report.id !== reportId)
    .map((report) => ({
      id: report.id,
      kind: "integrated-report",
      title: report.title,
      summary: report.summary,
      publishDate: report.publishDate,
      topicIds: report.topicIds,
      sportTags: report.sportTags,
      excerpt: normaliseWhitespace([
        report.question,
        ...(report.articleDigests ?? []).flatMap((digest) => [digest.headline, digest.summary, digest.whatIsNew, ...(digest.keyFindings ?? [])]),
        report.trend?.body
      ].filter(Boolean).join("\n"))
    }));

  return [...new Map([...integratedReports, ...curatedIssues].map((item) => [item.id, item])).values()];
}

function toPacketRecord(record) {
  return {
    id: record.id,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    journal: record.journal,
    journalAbbreviation: record.journalAbbreviation,
    title: record.title,
    publicationDate: record.publicationDate,
    authors: record.authors,
    doi: record.doi,
    pmid: record.pmid,
    sourceUrl: record.sourceUrl,
    fullTextUrl: record.fullTextUrl,
    pmcId: record.pmcId,
    publicationTypes: record.publicationTypes ?? [],
    themes: record.themes ?? [],
    sportTags: record.sportTags ?? []
  };
}

function toCourseMatch(match, targetText) {
  return {
    courseDocumentId: match.id,
    title: match.title,
    relativePath: match.relativePath,
    score: match.score,
    sharedConcepts: match.sharedConcepts,
    sharedTerms: match.sharedTokens,
    excerpt: extractRelevantExcerpt(match.text ?? match.excerpt, targetText, 2200)
  };
}

function toPriorIssueMatch(match, targetText) {
  return {
    issueId: match.id,
    title: match.title,
    publishDate: match.publishDate,
    score: match.score,
    sharedConcepts: match.sharedConcepts,
    sharedTerms: match.sharedTokens,
    excerpt: extractRelevantExcerpt(match.excerpt, targetText, 1800)
  };
}

function renderPacketMarkdown(packet) {
  const output = [
    `# Private Weekly Evidence Packet: ${packet.id}`,
    "",
    `- Target title: ${packet.titleMode === "fixed" ? packet.title : "Codex must create a concise, evidence-specific Traditional Chinese title"}`,
    `- Publication date: ${packet.publishDate}`,
    `- Prepared at: ${packet.generatedAt}`,
    "",
    "## Non-Negotiable Authoring Rules",
    ...packet.authoringRules.map((rule) => `- ${rule}`),
    "",
    "## Output Requirement",
    "Return JSON only. Follow the schema supplied by the generation command. Do not include Markdown code fences or commentary outside the JSON object.",
    "",
    "## Selected New Research"
  ];

  for (const [index, article] of packet.selectedArticles.entries()) {
    const referenceLabel = `R${index + 1}`;
    output.push(
      "",
      `### ${referenceLabel}: ${article.record.title}`,
      `- Record ID: ${article.record.id}`,
      `- Journal: ${article.record.journal}`,
      `- Date: ${article.record.publicationDate}`,
      `- DOI / source: ${article.record.sourceUrl}`,
      `- Content level: ${article.sourceMaterial.contentLevel}`,
      `- Source label: ${article.sourceMaterial.label}`
    );

    if (article.sourceMaterial.attachmentPath) {
      output.push(`- Full-text attachment path: ${article.sourceMaterial.attachmentPath}`);
    }

    if (article.sourceMaterial.publicationTypes.length > 0) {
      output.push(`- PubMed publication type: ${article.sourceMaterial.publicationTypes.join(", ")}`);
    }

    output.push("", "#### Supplied research text", article.sourceMaterial.sourceExcerpt || "No content text is available.");
    output.push("", "#### Matching inClass knowledge");
    output.push(article.inClassMatches.length > 0
      ? article.inClassMatches.map((match) => [
          `- Course ID: ${match.courseDocumentId}`,
          `  - Title: ${match.title}`,
          `  - Shared concepts: ${match.sharedConcepts.join(", ") || "keyword overlap"}`,
          `  - Excerpt: ${match.excerpt}`
        ].join("\n")).join("\n")
      : "- No direct course match was found by the controlled-concept matcher.");
    output.push("", "#### Relevant earlier weekly reports");
    output.push(article.priorIssueMatches.length > 0
      ? article.priorIssueMatches.map((match) => [
          `- Weekly ID: ${match.issueId}`,
          `  - Title: ${match.title} (${match.publishDate})`,
          `  - Shared concepts: ${match.sharedConcepts.join(", ") || "keyword overlap"}`,
          `  - Excerpt: ${match.excerpt}`
        ].join("\n")).join("\n")
      : "- No direct earlier weekly match was found by the controlled-concept matcher.");
  }

  if (packet.unavailableArticles.length > 0) {
    output.push("", "## Metadata-Only Records (Do Not Summarize)");
    output.push(...packet.unavailableArticles.map((article) => `- ${article.record.id}: ${article.record.title} (${article.record.sourceUrl})`));
  }

  return `${output.join("\n")}\n`;
}

function compareResearchRecords(left, right) {
  return dateValue(right) - dateValue(left) || String(left.title).localeCompare(String(right.title), "en");
}

function dateValue(record) {
  const parsedDate = Date.parse(record.discoveredAt ?? record.publicationDate);
  return Number.isNaN(parsedDate) ? 0 : parsedDate;
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

function parseCommaSeparatedValues(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parsePositiveInteger(value, label, minimum, maximum) {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsedValue;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readRequiredJson(path, message) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(message);
    }
    throw error;
  }
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toText(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toText(entry)).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    if (value["#text"] !== undefined) {
      return toText(value["#text"]);
    }
    return Object.values(value).map((entry) => toText(entry)).filter(Boolean).join(" ");
  }
  return "";
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#xa0;", " ")
    .replace(/&#(\d+);/g, (_, codePoint) => String.fromCodePoint(Number(codePoint)));
}

function relativePathFromRoot(path) {
  return path.slice(rootDirectory.length + 1).replaceAll("\\", "/");
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function isWithinCoverage(value, coverage) {
  if (!isDate(value) || !isDate(coverage?.from) || !isDate(coverage?.to)) return false;
  return value >= coverage.from && value <= coverage.to;
}

function formatWeekLabel(reportId) {
  const [year, week] = reportId.split("-w");
  return `${year} 年第 ${Number.parseInt(week, 10)} 週`;
}
