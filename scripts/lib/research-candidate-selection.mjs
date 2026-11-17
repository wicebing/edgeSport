export function buildResearchCandidatePool(records, options) {
  const {
    coverage,
    previouslyReportedRecordIds = new Set(),
    requestedTheme = "",
    fullTextOnly = false,
    fullTextLookbackDays = 28,
    isLowValueRecord = () => false
  } = options;
  const normalizedTheme = requestedTheme.toLocaleLowerCase("zh-Hant");
  const eligibleRecords = records
    .filter((record) => !previouslyReportedRecordIds.has(record.id))
    .filter((record) => !requestedTheme || (record.themes ?? []).some((theme) =>
      theme.toLocaleLowerCase("zh-Hant").includes(normalizedTheme)
    ))
    .filter((record) => !isLowValueRecord(record));
  const currentCoverageRecords = eligibleRecords.filter((record) =>
    isWithinDateCoverage(record.publicationDate, coverage)
  );

  if (!fullTextOnly) return currentCoverageRecords;

  const fallbackFrom = subtractUtcDays(coverage?.to, fullTextLookbackDays);
  if (!fallbackFrom) return currentCoverageRecords;
  const currentIds = new Set(currentCoverageRecords.map((record) => record.id));
  const recentFallbackRecords = eligibleRecords.filter((record) =>
    !currentIds.has(record.id)
    && isIsoDate(record.publicationDate)
    && record.publicationDate >= fallbackFrom
    && record.publicationDate <= coverage.to
  );

  return [...currentCoverageRecords, ...recentFallbackRecords];
}

export function isWithinDateCoverage(value, coverage) {
  if (!isIsoDate(value) || !isIsoDate(coverage?.from) || !isIsoDate(coverage?.to)) return false;
  return value >= coverage.from && value <= coverage.to;
}

function subtractUtcDays(value, days) {
  if (!isIsoDate(value) || !Number.isInteger(days) || days < 1) return null;
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}
