import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateResearchItem } from "./lib/research-review.mjs";
import { REPORT_CONTENT_LEVELS } from "./lib/weekly-report-schema.mjs";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentPath = resolve(rootDirectory, "content", "issues.json");
const radarPath = resolve(rootDirectory, "content", "research-radar.json");
const sourceRegistryPath = resolve(rootDirectory, "content", "source-registry.json");
const weeklyReportsPath = resolve(rootDirectory, "content", "weekly-reports.json");
const errors = [];

const requiredString = (value, location) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${location} must be a non-empty string.`);
  }
};

const requiredArray = (value, location) => {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${location} must be a non-empty array.`);
  }
};

const requiredHttpsUrl = (value, location) => {
  requiredString(value, location);

  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.protocol !== "https:") {
      errors.push(`${location} must use HTTPS.`);
    }
  } catch {
    errors.push(`${location} must be a valid URL.`);
  }
};

let content;
let radar;
let sourceRegistry;
let weeklyReports;

try {
  content = JSON.parse(await readFile(contentPath, "utf8"));
} catch (error) {
  console.error(`Unable to read ${contentPath}: ${error.message}`);
  process.exit(1);
}

try {
  radar = JSON.parse(await readFile(radarPath, "utf8"));
  sourceRegistry = JSON.parse(await readFile(sourceRegistryPath, "utf8"));
  weeklyReports = JSON.parse(await readFile(weeklyReportsPath, "utf8"));
} catch (error) {
  console.error(`Unable to read research-radar data: ${error.message}`);
  process.exit(1);
}

requiredString(content?.site?.name, "site.name");
requiredString(content?.site?.tagline, "site.tagline");
requiredString(content?.site?.lastReviewed, "site.lastReviewed");
requiredHttpsUrl(content?.site?.heroImage?.src, "site.heroImage.src");
requiredArray(content?.topics, "topics");
requiredArray(content?.journals, "journals");
requiredArray(content?.issues, "issues");

const topicIds = new Set();
for (const topic of content.topics ?? []) {
  requiredString(topic.id, "topics[].id");
  requiredString(topic.label, `topic ${topic.id ?? "unknown"}.label`);

  if (topicIds.has(topic.id)) {
    errors.push(`Duplicate topic id: ${topic.id}`);
  }

  topicIds.add(topic.id);
}

const issueIds = new Set();
for (const issue of content.issues ?? []) {
  const issueLocation = `issue ${issue.id ?? "unknown"}`;
  requiredString(issue.id, `${issueLocation}.id`);
  requiredString(issue.status, `${issueLocation}.status`);
  requiredString(issue.publishDate, `${issueLocation}.publishDate`);
  requiredString(issue.weekLabel, `${issueLocation}.weekLabel`);
  requiredString(issue.title, `${issueLocation}.title`);
  requiredString(issue.summary, `${issueLocation}.summary`);
  requiredString(issue.question, `${issueLocation}.question`);
  requiredString(issue.evidenceLens, `${issueLocation}.evidenceLens`);
  requiredHttpsUrl(issue?.coverImage?.src, `${issueLocation}.coverImage.src`);
  requiredArray(issue.topicIds, `${issueLocation}.topicIds`);

  if (issueIds.has(issue.id)) {
    errors.push(`Duplicate issue id: ${issue.id}`);
  }

  issueIds.add(issue.id);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue.publishDate ?? "")) {
    errors.push(`${issueLocation}.publishDate must use YYYY-MM-DD.`);
  }

  for (const topicId of issue.topicIds ?? []) {
    if (!topicIds.has(topicId)) {
      errors.push(`${issueLocation} references an unknown topic: ${topicId}`);
    }
  }

  if (issue.status === "published") {
    requiredArray(issue.takeaways, `${issueLocation}.takeaways`);
    requiredArray(issue.decisionPath, `${issueLocation}.decisionPath`);
    requiredArray(issue.fieldChecklist, `${issueLocation}.fieldChecklist`);
    requiredArray(issue.metrics, `${issueLocation}.metrics`);
    requiredArray(issue.evidence, `${issueLocation}.evidence`);

    if ((issue.evidence?.length ?? 0) < 2) {
      errors.push(`${issueLocation} needs at least two evidence sources before publishing.`);
    }
  }

  for (const reference of issue.evidence ?? []) {
    requiredString(reference.type, `${issueLocation}.evidence[].type`);
    requiredString(reference.citation, `${issueLocation}.evidence[].citation`);
    requiredString(reference.source, `${issueLocation}.evidence[].source`);
    requiredHttpsUrl(reference.url, `${issueLocation}.evidence[].url`);
  }
}

for (const journal of content.journals ?? []) {
  requiredString(journal.id, "journals[].id");
  requiredString(journal.name, `journal ${journal.id ?? "unknown"}.name`);
  requiredHttpsUrl(journal.url, `journal ${journal.id ?? "unknown"}.url`);
}

validateSourceRegistry(sourceRegistry);
validateResearchRadar(radar, issueIds);
validateWeeklyReports(weeklyReports, issueIds, topicIds);

if (errors.length > 0) {
  console.error("Content validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const publishedCount = content.issues.filter((issue) => issue.status === "published").length;
console.log(`Validated ${publishedCount} published issues, ${weeklyReports.reports.length} integrated weekly reports, ${radar.items.length} radar records, ${content.topics.length} topics, ${sourceRegistry.pubmed.journals.length} indexed journals, ${sourceRegistry.officialOrganizations.length} official organizations, and ${sourceRegistry.rssFeeds.length} verified feeds.`);

function validateSourceRegistry(registry) {
  requiredArray(registry?.pubmed?.journals, "source-registry.pubmed.journals");
  requiredArray(registry?.officialOrganizations, "source-registry.officialOrganizations");

  if (!Array.isArray(registry?.rssFeeds)) {
    errors.push("source-registry.rssFeeds must be an array.");
  }

  const sourceIds = new Set();
  for (const journal of registry?.pubmed?.journals ?? []) {
    requiredString(journal.id, "source-registry.pubmed.journals[].id");
    requiredString(journal.name, `source registry journal ${journal.id ?? "unknown"}.name`);
    requiredString(journal.pubmedJournal, `source registry journal ${journal.id ?? "unknown"}.pubmedJournal`);
    requiredHttpsUrl(journal.officialUrl, `source registry journal ${journal.id ?? "unknown"}.officialUrl`);
    addUniqueSourceId(journal.id, sourceIds, "source registry journal");
  }

  for (const organization of registry?.officialOrganizations ?? []) {
    requiredString(organization.id, "source-registry.officialOrganizations[].id");
    requiredString(organization.name, `official organization ${organization.id ?? "unknown"}.name`);
    requiredHttpsUrl(organization.officialUrl, `official organization ${organization.id ?? "unknown"}.officialUrl`);
    addUniqueSourceId(organization.id, sourceIds, "official organization");
  }

  for (const feed of registry?.rssFeeds ?? []) {
    requiredString(feed.id, "source-registry.rssFeeds[].id");
    requiredString(feed.label, `official feed ${feed.id ?? "unknown"}.label`);
    requiredHttpsUrl(feed.officialUrl, `official feed ${feed.id ?? "unknown"}.officialUrl`);
    requiredHttpsUrl(feed.feedUrl, `official feed ${feed.id ?? "unknown"}.feedUrl`);
    addUniqueSourceId(feed.id, sourceIds, "official feed");
  }
}

function validateResearchRadar(researchRadar, publishedIssueIds) {
  if (researchRadar?.schemaVersion !== 1) {
    errors.push("research-radar.schemaVersion must be 1.");
  }

  if (!Array.isArray(researchRadar?.sourceStatus)) {
    errors.push("research-radar.sourceStatus must be an array.");
  }
  if (!Array.isArray(researchRadar?.trendSignals)) {
    errors.push("research-radar.trendSignals must be an array.");
  }
  if (!Array.isArray(researchRadar?.items)) {
    errors.push("research-radar.items must be an array.");
    return;
  }

  const radarIds = new Set();
  for (const item of researchRadar.items) {
    const location = `research-radar item ${item?.id ?? "unknown"}`;
    if (radarIds.has(item?.id)) {
      errors.push(`Duplicate research-radar item id: ${item.id}`);
    }
    radarIds.add(item?.id);
    errors.push(...validateResearchItem(item, location));

    if (item?.status === "featured" && !publishedIssueIds.has(item.featuredInIssueId)) {
      errors.push(`${location}.featuredInIssueId must refer to a published issue.`);
    }
  }
}

function addUniqueSourceId(sourceId, knownIds, location) {
  if (knownIds.has(sourceId)) {
    errors.push(`Duplicate ${location} id: ${sourceId}`);
  }
  knownIds.add(sourceId);
}

function validateWeeklyReports(reportsData, publishedIssueIds, knownTopicIds) {
  if (reportsData?.schemaVersion !== 1) {
    errors.push("weekly-reports.schemaVersion must be 1.");
  }
  if (!Array.isArray(reportsData?.reports)) {
    errors.push("weekly-reports.reports must be an array.");
    return;
  }

  const reportIds = new Set();
  for (const report of reportsData.reports) {
    const location = `weekly report ${report?.id ?? "unknown"}`;
    requiredString(report?.id, `${location}.id`);
    requiredString(report?.title, `${location}.title`);
    requiredString(report?.summary, `${location}.summary`);
    requiredString(report?.question, `${location}.question`);
    requiredString(report?.evidenceStatement, `${location}.evidenceStatement`);
    requiredString(report?.publishDate, `${location}.publishDate`);

    if (reportIds.has(report?.id)) {
      errors.push(`Duplicate weekly report id: ${report.id}`);
    }
    reportIds.add(report?.id);

    if (report?.status !== "published") {
      errors.push(`${location}.status must be published in public data.`);
    }
    const publicationMode = report?.publicationMode ?? "editor-reviewed";
    if (!["automated", "editor-reviewed"].includes(publicationMode)) {
      errors.push(`${location}.publicationMode must be automated or editor-reviewed.`);
    } else if (publicationMode === "automated") {
      if (report?.editorReview?.approvedForPublish !== false) {
        errors.push(`${location}.editorReview.approvedForPublish must remain false for automated publication.`);
      }
      requiredString(report?.automationProvider, `${location}.automationProvider`);
    } else {
      if (report?.editorReview?.approvedForPublish !== true) {
        errors.push(`${location}.editorReview.approvedForPublish must be true for editor-reviewed publication.`);
      }
      requiredString(report?.editorReview?.verifiedBy, `${location}.editorReview.verifiedBy`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(report?.editorReview?.verifiedAt ?? "")) {
        errors.push(`${location}.editorReview.verifiedAt must use YYYY-MM-DD.`);
      }
    }

    if (!Array.isArray(report?.topicIds) || report.topicIds.length === 0) {
      errors.push(`${location}.topicIds must contain at least one site topic.`);
    }
    for (const topicId of report?.topicIds ?? []) {
      if (!knownTopicIds.has(topicId)) {
        errors.push(`${location}.topicIds includes unknown site topic ${topicId}.`);
      }
    }

    const researchSourceIds = new Set();
    const sourceLevels = new Map();
    for (const source of report?.researchSources ?? []) {
      requiredString(source?.recordId, `${location}.researchSources[].recordId`);
      requiredString(source?.title, `${location}.researchSources[${source?.recordId ?? "unknown"}].title`);
      requiredString(source?.journal, `${location}.researchSources[${source?.recordId ?? "unknown"}].journal`);
      requiredHttpsUrl(source?.sourceUrl, `${location}.researchSources[${source?.recordId ?? "unknown"}].sourceUrl`);
      if (!REPORT_CONTENT_LEVELS.has(source?.contentLevel)) {
        errors.push(`${location}.researchSources[${source?.recordId ?? "unknown"}].contentLevel is invalid.`);
      }
      researchSourceIds.add(source?.recordId);
      sourceLevels.set(source?.recordId, source?.contentLevel);
    }
    if (researchSourceIds.size === 0) {
      errors.push(`${location}.researchSources must contain at least one research link.`);
    }

    const courseSourceIds = new Set((report?.courseSources ?? []).map((source) => source.id));
    const priorIssueSourceIds = new Set((report?.priorWeeklySources ?? []).map((source) => source.id));
    for (const source of report?.priorWeeklySources ?? []) {
      if (!publishedIssueIds.has(source?.id)) {
        errors.push(`${location}.priorWeeklySources includes unknown published issue ${source?.id}.`);
      }
    }

    for (const digest of report?.articleDigests ?? []) {
      const digestLocation = `${location}.articleDigests[${digest?.recordId ?? "unknown"}]`;
      if (!researchSourceIds.has(digest?.recordId)) {
        errors.push(`${digestLocation} must refer to a research source.`);
      }
      if (sourceLevels.get(digest?.recordId) !== digest?.contentLevel) {
        errors.push(`${digestLocation}.contentLevel must match its research source.`);
      }
      requiredString(digest?.headline, `${digestLocation}.headline`);
      requiredString(digest?.summary, `${digestLocation}.summary`);
      requiredString(digest?.whatIsNew, `${digestLocation}.whatIsNew`);
      requiredArray(digest?.keyFindings, `${digestLocation}.keyFindings`);
      requiredArray(digest?.practicalImplications, `${digestLocation}.practicalImplications`);
      requiredArray(digest?.cautions, `${digestLocation}.cautions`);
      validateComparisonReference(digest?.inClassComparison, courseSourceIds, `${digestLocation}.inClassComparison`);
      validateComparisonReference(digest?.priorWeeklyComparison, priorIssueSourceIds, `${digestLocation}.priorWeeklyComparison`);
    }

    if (!Array.isArray(report?.articleDigests) || report.articleDigests.length === 0) {
      errors.push(`${location}.articleDigests must contain at least one article.`);
    }
  }
}

function validateComparisonReference(comparison, allowedSourceIds, location) {
  if (!["matched", "no-direct-match"].includes(comparison?.matchStatus)) {
    errors.push(`${location}.matchStatus must be matched or no-direct-match.`);
  }
  requiredString(comparison?.summary, `${location}.summary`);
  if (!Array.isArray(comparison?.sourceIds)) {
    errors.push(`${location}.sourceIds must be an array.`);
    return;
  }
  for (const sourceId of comparison.sourceIds) {
    if (!allowedSourceIds.has(sourceId)) {
      errors.push(`${location}.sourceIds includes unavailable source ${sourceId}.`);
    }
  }
  if (comparison.matchStatus === "matched" && comparison.sourceIds.length === 0) {
    errors.push(`${location}.sourceIds must not be empty when matched.`);
  }
  if (comparison.matchStatus === "no-direct-match" && comparison.sourceIds.length > 0) {
    errors.push(`${location}.sourceIds must be empty when no-direct-match.`);
  }
}
