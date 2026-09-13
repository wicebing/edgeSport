export const REVIEWED_STATUSES = new Set(["reviewed", "featured"]);

export const REQUIRED_REVIEW_SECTIONS = [
  "abstract",
  "introduction",
  "methods",
  "results",
  "discussion",
  "limitations",
  "tablesAndFigures"
];

const ALLOWED_SOURCE_ACCESS = new Set([
  "open-access",
  "institutional-license",
  "author-provided-copy",
  "public-web-content"
]);

export function validateResearchItem(item, location) {
  const errors = [];
  requireString(item?.id, `${location}.id`, errors);
  requireString(item?.status, `${location}.status`, errors);
  requireString(item?.sourceType, `${location}.sourceType`, errors);
  requireString(item?.journal, `${location}.journal`, errors);
  requireString(item?.title, `${location}.title`, errors);
  requireString(item?.publicationDate, `${location}.publicationDate`, errors);
  requireHttpsUrl(item?.sourceUrl, `${location}.sourceUrl`, errors);

  if (!new Set(["discovered", "reviewed", "featured"]).has(item?.status)) {
    errors.push(`${location}.status must be discovered, reviewed, or featured.`);
  }

  if (!Array.isArray(item?.themes)) {
    errors.push(`${location}.themes must be an array.`);
  }

  if (item?.fullTextUrl !== null && item?.fullTextUrl !== undefined) {
    requireHttpsUrl(item.fullTextUrl, `${location}.fullTextUrl`, errors);
  }

  if (REVIEWED_STATUSES.has(item?.status)) {
    errors.push(...validateReviewedRecord(item, location));
  }

  return errors;
}

export function validateReviewedRecord(item, location) {
  const errors = [];
  const review = item?.review;
  const rights = item?.rights;
  const synthesisTable = item?.synthesisTable;
  const visualization = item?.visualization;

  if (review?.fullTextRead !== true) {
    errors.push(`${location}.review.fullTextRead must be true before publication.`);
  }

  requireString(review?.reviewedBy, `${location}.review.reviewedBy`, errors);
  requireDate(review?.reviewedAt, `${location}.review.reviewedAt`, errors);
  requireString(review?.studyDesign, `${location}.review.studyDesign`, errors);
  requireString(review?.population, `${location}.review.population`, errors);
  requireString(review?.setting, `${location}.review.setting`, errors);
  requireString(review?.summary, `${location}.review.summary`, errors);
  requireStringArray(review?.keyFindings, `${location}.review.keyFindings`, 2, errors);
  requireStringArray(review?.limitations, `${location}.review.limitations`, 1, errors);

  for (const section of REQUIRED_REVIEW_SECTIONS) {
    if (review?.sections?.[section] !== true) {
      errors.push(`${location}.review.sections.${section} must be true before publication.`);
    }
  }

  if (![true, "not-available"].includes(review?.sections?.supplementaryMaterial)) {
    errors.push(`${location}.review.sections.supplementaryMaterial must be true or not-available.`);
  }

  if (!ALLOWED_SOURCE_ACCESS.has(rights?.sourceAccess)) {
    errors.push(`${location}.rights.sourceAccess must declare the lawful access route.`);
  }

  if (rights?.publicUse !== "editor-created-summary-and-synthesis") {
    errors.push(`${location}.rights.publicUse must be editor-created-summary-and-synthesis.`);
  }

  if (rights?.originalMaterialReproduced !== false) {
    errors.push(`${location}.rights.originalMaterialReproduced must be false.`);
  }

  requireTable(synthesisTable, `${location}.synthesisTable`, errors);
  requireVisualization(visualization, `${location}.visualization`, errors);

  if (item?.status === "featured") {
    requireString(item?.featuredInIssueId, `${location}.featuredInIssueId`, errors);
  }

  return errors;
}

function requireTable(table, location, errors) {
  requireString(table?.title, `${location}.title`, errors);
  requireString(table?.sourceNote, `${location}.sourceNote`, errors);

  if (!Array.isArray(table?.headers) || table.headers.length < 2 || !table.headers.every(isNonEmptyString)) {
    errors.push(`${location}.headers must contain at least two non-empty labels.`);
  }

  if (!Array.isArray(table?.rows) || table.rows.length === 0) {
    errors.push(`${location}.rows must contain at least one editor-created synthesis row.`);
    return;
  }

  for (const row of table.rows) {
    if (!Array.isArray(row) || row.length !== table.headers?.length || !row.every(isNonEmptyString)) {
      errors.push(`${location}.rows must match the header count and use non-empty text.`);
      return;
    }
  }
}

function requireVisualization(visualization, location, errors) {
  if (visualization?.type !== "bar") {
    errors.push(`${location}.type must be bar.`);
  }

  requireString(visualization?.title, `${location}.title`, errors);
  requireString(visualization?.caption, `${location}.caption`, errors);
  requireString(visualization?.unit, `${location}.unit`, errors);
  requireString(visualization?.sourceNote, `${location}.sourceNote`, errors);

  if (!Array.isArray(visualization?.data) || visualization.data.length < 2) {
    errors.push(`${location}.data must contain at least two editor-created values.`);
    return;
  }

  for (const datum of visualization.data) {
    if (!isNonEmptyString(datum?.label) || !Number.isFinite(datum?.value) || datum.value < 0 || !isNonEmptyString(datum?.detail)) {
      errors.push(`${location}.data entries require a label, non-negative numeric value, and detail.`);
      return;
    }
  }
}

function requireString(value, location, errors) {
  if (!isNonEmptyString(value)) {
    errors.push(`${location} must be a non-empty string.`);
  }
}

function requireStringArray(value, location, minimumLength, errors) {
  if (!Array.isArray(value) || value.length < minimumLength || !value.every(isNonEmptyString)) {
    errors.push(`${location} must contain at least ${minimumLength} non-empty items.`);
  }
}

function requireDate(value, location, errors) {
  if (!isNonEmptyString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${location} must use YYYY-MM-DD.`);
  }
}

function requireHttpsUrl(value, location, errors) {
  if (!isNonEmptyString(value)) {
    errors.push(`${location} must be a non-empty HTTPS URL.`);
    return;
  }

  try {
    if (new URL(value).protocol !== "https:") {
      errors.push(`${location} must use HTTPS.`);
    }
  } catch {
    errors.push(`${location} must be a valid URL.`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}