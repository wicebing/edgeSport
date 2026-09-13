export const REPORT_CONTENT_LEVELS = new Set(["full-text-web", "full-text-local", "full-text-open", "full-text-excerpt", "abstract-only"]);

export function validateWeeklyReport(report, context = {}, options = {}) {
  const errors = [];
  const sourceRecordIds = new Set(context.sourceRecordIds ?? []);
  const availableLevels = context.contentLevelByRecord ?? new Map();
  const allowedCourseIdsByRecord = context.courseIdsByRecord ?? new Map();
  const allowedIssueIdsByRecord = context.issueIdsByRecord ?? new Map();

  requireExactValue(report?.schemaVersion, 1, "weekly report.schemaVersion", errors);
  requireString(report?.id, "weekly report.id", errors);
  requireOneOf(report?.status, ["draft", "published"], "weekly report.status", errors);
  requireDate(report?.publishDate, "weekly report.publishDate", errors);
  requireString(report?.weekLabel, "weekly report.weekLabel", errors);
  requireString(report?.title, "weekly report.title", errors);
  requireString(report?.summary, "weekly report.summary", errors);
  requireString(report?.question, "weekly report.question", errors);
  requireString(report?.evidenceStatement, "weekly report.evidenceStatement", errors);
  requireString(report?.trend?.title, "weekly report.trend.title", errors);
  requireString(report?.trend?.body, "weekly report.trend.body", errors);
  requireStringArray(report?.topicIds, "weekly report.topicIds", 1, errors);
  requireStringArray(report?.sportTags, "weekly report.sportTags", 1, errors);
  requireUniqueStringArray(report?.sourceRecordIds, "weekly report.sourceRecordIds", 1, errors);

  if (sourceRecordIds.size > 0) {
    const reportedSourceIds = new Set(report?.sourceRecordIds ?? []);
    for (const recordId of report?.sourceRecordIds ?? []) {
      if (!sourceRecordIds.has(recordId)) {
        errors.push(`weekly report.sourceRecordIds includes unavailable record ${recordId}.`);
      }
    }
    for (const recordId of sourceRecordIds) {
      if (!reportedSourceIds.has(recordId)) {
        errors.push(`weekly report.sourceRecordIds is missing selected record ${recordId}.`);
      }
    }
  }

  if (!Array.isArray(report?.articleDigests) || report.articleDigests.length === 0) {
    errors.push("weekly report.articleDigests must contain at least one synthesis.");
  } else {
    const digestIds = new Set();
    for (const digest of report.articleDigests) {
      validateArticleDigest(digest, {
        sourceRecordIds,
        availableLevels,
        allowedCourseIds: allowedCourseIdsByRecord.get(digest?.recordId),
        allowedIssueIds: allowedIssueIdsByRecord.get(digest?.recordId)
      }, errors);

      if (digestIds.has(digest?.recordId)) {
        errors.push(`weekly report.articleDigests repeats ${digest?.recordId}.`);
      }
      digestIds.add(digest?.recordId);
    }
    for (const recordId of report?.sourceRecordIds ?? []) {
      if (!digestIds.has(recordId)) {
        errors.push(`weekly report.articleDigests is missing ${recordId}.`);
      }
    }
  }

  validateComparisonTable(report?.comparisonTable, errors);
  validateEditorialReview(report?.editorReview, options.requireApproval === true, errors);
  return errors;
}

export function buildPublicReport(draft, packet, options = {}) {
  const recordsById = new Map((packet.selectedArticles ?? []).map((article) => [article.record.id, article]));
  const coursesById = new Map((packet.courseDocuments ?? []).map((course) => [course.id, course]));
  const issuesById = new Map((packet.priorIssues ?? []).map((issue) => [issue.id, issue]));

  return {
    ...draft,
    status: "published",
    publicationMode: options.publicationMode ?? "editor-reviewed",
    automationProvider: options.automationProvider ?? null,
    generatedAt: packet.generatedAt,
    publishedAt: new Date().toISOString(),
    researchSources: draft.sourceRecordIds.map((recordId) => {
      const article = recordsById.get(recordId);
      return {
        recordId,
        title: article.record.title,
        journal: article.record.journal,
        publicationDate: article.record.publicationDate,
        sourceUrl: article.record.sourceUrl,
        fullTextUrl: article.record.fullTextUrl ?? null,
        contentLevel: article.sourceMaterial.contentLevel
      };
    }),
    courseSources: uniqueById(draft.articleDigests.flatMap((digest) => digest.inClassComparison.sourceIds))
      .map((courseId) => {
        const course = coursesById.get(courseId);
        return course ? { id: course.id, title: course.title } : null;
      })
      .filter(Boolean),
    priorWeeklySources: uniqueById(draft.articleDigests.flatMap((digest) => digest.priorWeeklyComparison.sourceIds))
      .map((issueId) => {
        const issue = issuesById.get(issueId);
        return issue ? { id: issue.id, title: issue.title, publishDate: issue.publishDate, kind: issue.kind ?? "curated-issue" } : null;
      })
      .filter(Boolean)
  };
}

function validateArticleDigest(digest, context, errors) {
  requireString(digest?.recordId, "weekly report.articleDigests[].recordId", errors);
  requireOneOf(digest?.contentLevel, [...REPORT_CONTENT_LEVELS], `weekly report.articleDigests[${digest?.recordId ?? "unknown"}].contentLevel`, errors);
  requireString(digest?.headline, `weekly report.articleDigests[${digest?.recordId ?? "unknown"}].headline`, errors);
  requireString(digest?.summary, `weekly report.articleDigests[${digest?.recordId ?? "unknown"}].summary`, errors);
  requireString(digest?.whatIsNew, `weekly report.articleDigests[${digest?.recordId ?? "unknown"}].whatIsNew`, errors);
  requireStringArray(digest?.keyFindings, `weekly report.articleDigests[${digest?.recordId ?? "unknown"}].keyFindings`, 1, errors);
  requireStringArray(digest?.practicalImplications, `weekly report.articleDigests[${digest?.recordId ?? "unknown"}].practicalImplications`, 1, errors);
  requireStringArray(digest?.cautions, `weekly report.articleDigests[${digest?.recordId ?? "unknown"}].cautions`, 1, errors);
  validateEvidenceTable(digest?.evidenceTable, `weekly report.articleDigests[${digest?.recordId ?? "unknown"}].evidenceTable`, errors);
  validateVisualization(digest?.visualization, `weekly report.articleDigests[${digest?.recordId ?? "unknown"}].visualization`, errors);

  if (context.sourceRecordIds.size > 0 && !context.sourceRecordIds.has(digest?.recordId)) {
    errors.push(`weekly report.articleDigests references an unavailable record ${digest?.recordId}.`);
  }

  const expectedLevel = context.availableLevels.get(digest?.recordId);
  if (expectedLevel && digest?.contentLevel !== expectedLevel) {
    errors.push(`weekly report.articleDigests[${digest?.recordId}].contentLevel must be ${expectedLevel}.`);
  }
  if (["full-text-web", "full-text-local", "full-text-open"].includes(expectedLevel)) {
    const synthesisText = [digest?.headline, digest?.summary, digest?.whatIsNew, ...(digest?.keyFindings ?? []), ...(digest?.cautions ?? [])].join(" ");
    if (/待(?:完整閱讀|全文核查|核查)|尚未完成全文|未能閱讀完整附件|不列正式研究發現|無法依指定規則完成/iu.test(synthesisText)) {
      errors.push(`weekly report.articleDigests[${digest?.recordId}] contains a placeholder instead of a completed full-text synthesis.`);
    }
  }

  validateKnowledgeComparison(digest?.inClassComparison, "inClassComparison", context.allowedCourseIds, errors);
  validateKnowledgeComparison(digest?.priorWeeklyComparison, "priorWeeklyComparison", context.allowedIssueIds, errors);
}

function validateKnowledgeComparison(comparison, label, allowedIds, errors) {
  const location = `weekly report.articleDigests[].${label}`;
  requireOneOf(comparison?.matchStatus, ["matched", "no-direct-match"], `${location}.matchStatus`, errors);
  requireString(comparison?.summary, `${location}.summary`, errors);
  requireUniqueStringArray(comparison?.sourceIds, `${location}.sourceIds`, 0, errors);

  if (comparison?.matchStatus === "matched" && (comparison.sourceIds?.length ?? 0) === 0) {
    errors.push(`${location} must name at least one source when matchStatus is matched.`);
  }

  if (comparison?.matchStatus === "no-direct-match" && (comparison.sourceIds?.length ?? 0) > 0) {
    errors.push(`${location} cannot name sources when matchStatus is no-direct-match.`);
  }

  if (allowedIds) {
    for (const sourceId of comparison?.sourceIds ?? []) {
      if (!allowedIds.has(sourceId)) {
        errors.push(`${location}.sourceIds includes a source that was not offered to the model: ${sourceId}.`);
      }
    }
  }
}

function validateComparisonTable(table, errors) {
  requireString(table?.title, "weekly report.comparisonTable.title", errors);
  if (!Array.isArray(table?.headers) || table.headers.length < 3 || !table.headers.every(isNonEmptyString)) {
    errors.push("weekly report.comparisonTable.headers must contain at least three labels.");
  }

  if (!Array.isArray(table?.rows) || table.rows.length === 0) {
    errors.push("weekly report.comparisonTable.rows must contain at least one row.");
    return;
  }

  for (const row of table.rows) {
    if (!Array.isArray(row) || row.length !== table.headers?.length || !row.every(isNonEmptyString)) {
      errors.push("weekly report.comparisonTable.rows must match the headers and use non-empty text.");
      return;
    }
  }
}

function validateEditorialReview(review, requireApproval, errors) {
  if (review?.approvedForPublish !== true && review?.approvedForPublish !== false) {
    errors.push("weekly report.editorReview.approvedForPublish must be true or false.");
  }

  if (!requireApproval) {
    return;
  }

  if (review?.approvedForPublish !== true) {
    errors.push("weekly report.editorReview.approvedForPublish must be true before publication.");
  }
  requireString(review?.verifiedBy, "weekly report.editorReview.verifiedBy", errors);
  requireDate(review?.verifiedAt, "weekly report.editorReview.verifiedAt", errors);
}

function requireExactValue(value, expected, location, errors) {
  if (value !== expected) {
    errors.push(`${location} must be ${expected}.`);
  }
}

function requireOneOf(value, allowedValues, location, errors) {
  if (!allowedValues.includes(value)) {
    errors.push(`${location} must be one of: ${allowedValues.join(", ")}.`);
  }
}

function requireString(value, location, errors) {
  if (!isNonEmptyString(value)) {
    errors.push(`${location} must be a non-empty string.`);
  }
}

function requireStringArray(value, location, minimumLength, errors) {
  if (!Array.isArray(value) || value.length < minimumLength || !value.every(isNonEmptyString)) {
    errors.push(`${location} must contain at least ${minimumLength} non-empty item${minimumLength === 1 ? "" : "s"}.`);
  }
}

function requireUniqueStringArray(value, location, minimumLength, errors) {
  requireStringArray(value, location, minimumLength, errors);
  if (Array.isArray(value) && new Set(value).size !== value.length) {
    errors.push(`${location} must not contain duplicates.`);
  }
}

function requireDate(value, location, errors) {
  if (!isNonEmptyString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${location} must use YYYY-MM-DD.`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueById(values) {
  return [...new Set(values)];
}

function validateEvidenceTable(table, location, errors) {
  requireString(table?.title, `${location}.title`, errors);
  requireString(table?.sourceNote, `${location}.sourceNote`, errors);
  if (!Array.isArray(table?.headers) || table.headers.length < 2 || !table.headers.every(isNonEmptyString)) {
    errors.push(`${location}.headers must contain at least two non-empty labels.`);
  }
  if (!Array.isArray(table?.rows) || table.rows.length === 0) {
    errors.push(`${location}.rows must contain at least one original synthesis row.`);
    return;
  }
  for (const row of table.rows) {
    if (!Array.isArray(row) || row.length !== table.headers?.length || !row.every(isNonEmptyString)) {
      errors.push(`${location}.rows must match the headers and use non-empty text.`);
      return;
    }
  }
}

function validateVisualization(visualization, location, errors) {
  if (visualization === null || visualization === undefined) {
    return;
  }
  if (visualization.type !== "bar") {
    errors.push(`${location}.type must be bar.`);
  }
  requireString(visualization.title, `${location}.title`, errors);
  requireString(visualization.caption, `${location}.caption`, errors);
  requireString(visualization.unit, `${location}.unit`, errors);
  requireString(visualization.sourceNote, `${location}.sourceNote`, errors);
  if (!Array.isArray(visualization.data) || visualization.data.length < 2) {
    errors.push(`${location}.data must contain at least two values, or visualization must be null.`);
    return;
  }
  for (const datum of visualization.data) {
    if (!isNonEmptyString(datum?.label) || !Number.isFinite(datum?.value) || datum.value < 0 || !isNonEmptyString(datum?.detail)) {
      errors.push(`${location}.data entries require a label, non-negative numeric value, and detail.`);
      return;
    }
  }
}
