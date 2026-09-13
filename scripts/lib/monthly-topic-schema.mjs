const BASIS_VALUES = new Set(["source-stated", "inclass-supported", "prior-report-supported", "cross-source-synthesis", "edge-sport-proposal", "mixed"]);
const EVIDENCE_LEVELS = new Set(["high", "moderate", "low", "very-low", "not-graded"]);
const URGENCY_VALUES = new Set(["modify", "stop", "urgent-referral"]);

export function validateMonthlyTopic(topic, context = {}) {
  const errors = [];
  const sourceIds = new Set(context.researchSourceIds ?? []);
  const affairIds = new Set(context.currentAffairIds ?? []);
  const courseIds = new Set(context.courseIds ?? []);
  const priorIds = new Set(context.priorReportIds ?? []);

  exact(topic?.schemaVersion, 1, "monthly topic.schemaVersion", errors);
  string(topic?.id, "monthly topic.id", errors);
  if (!/^\d{4}-m(0[1-9]|1[0-2])$/u.test(topic?.id ?? "")) errors.push("monthly topic.id must use YYYY-mMM.");
  exact(topic?.kind, "monthly-deep-dive", "monthly topic.kind", errors);
  oneOf(topic?.status, ["draft", "published"], "monthly topic.status", errors);
  date(topic?.publishDate, "monthly topic.publishDate", errors);
  for (const field of ["monthLabel", "weekLabel", "title", "summary", "question", "evidenceLens"]) {
    string(topic?.[field], `monthly topic.${field}`, errors);
  }
  if (!Number.isInteger(topic?.readingMinutes) || topic.readingMinutes < 12 || topic.readingMinutes > 60) {
    errors.push("monthly topic.readingMinutes must be an integer from 12 to 60.");
  }
  stringArray(topic?.topicIds, "monthly topic.topicIds", 1, errors);
  stringArray(topic?.sportTags, "monthly topic.sportTags", 1, errors);
  for (const field of ["currentSignal", "knowledgeGap", "decisionNeed"]) {
    string(topic?.whyNow?.[field], `monthly topic.whyNow.${field}`, errors);
  }
  stringArray(topic?.learningObjectives, "monthly topic.learningObjectives", 3, errors);
  validatePrimer(topic?.knowledgePrimer, sourceIds, errors);

  if (!Array.isArray(topic?.keyNumbers) || topic.keyNumbers.length < 3) {
    errors.push("monthly topic.keyNumbers must contain at least three traceable values.");
  } else {
    for (const item of topic.keyNumbers) {
      for (const field of ["value", "label", "context"]) string(item?.[field], `monthly topic.keyNumbers[].${field}`, errors);
      stringArray(item?.sourceIds, "monthly topic.keyNumbers[].sourceIds", 1, errors);
      allowedIds(item?.sourceIds, sourceIds, "monthly topic.keyNumbers[].sourceIds", errors);
    }
  }

  uniqueStringArray(topic?.researchSourceIds, "monthly topic.researchSourceIds", 2, errors);
  allowedIds(topic?.researchSourceIds, sourceIds, "monthly topic.researchSourceIds", errors);
  validateEvidenceSynthesis(topic?.evidenceSynthesis, new Set(topic?.researchSourceIds ?? []), errors);
  validateVisualization(topic?.visualization, errors);
  validateTable(topic?.comparisonTable, "monthly topic.comparisonTable", errors);
  validateTakeaways(topic?.takeaways, errors);
  validateActionProtocol(topic?.actionProtocol, errors);
  validateDecisionPath(topic?.decisionPath, errors);
  stringArray(topic?.fieldChecklist, "monthly topic.fieldChecklist", 5, errors);
  validateMetrics(topic?.metrics, errors);
  validateConnections(topic?.currentAffairs, "sourceId", affairIds, ["relevance", "evidenceBoundary"], "monthly topic.currentAffairs", 1, errors);
  validateConnections(topic?.courseConnectionsDetailed, "courseId", courseIds, ["knowledge", "progression"], "monthly topic.courseConnectionsDetailed", 1, errors);
  validateConnections(topic?.priorReportConnections, "reportId", priorIds, ["knowledge", "progression"], "monthly topic.priorReportConnections", 1, errors);
  string(topic?.trend?.title, "monthly topic.trend.title", errors);
  string(topic?.trend?.body, "monthly topic.trend.body", errors);
  stringArray(topic?.uncertainties, "monthly topic.uncertainties", 2, errors);
  if (topic?.editorReview?.approvedForPublish !== false && topic?.editorReview?.approvedForPublish !== true) {
    errors.push("monthly topic.editorReview.approvedForPublish must be boolean.");
  }
  if (topic?.status === "draft" && topic?.editorReview?.approvedForPublish !== false) {
    errors.push("monthly topic.editorReview.approvedForPublish must remain false in a draft.");
  }
  return errors;
}

function validatePrimer(primer, sourceIds, errors) {
  string(primer?.overview, "monthly topic.knowledgePrimer.overview", errors);
  if (!Array.isArray(primer?.definitions) || primer.definitions.length < 3) {
    errors.push("monthly topic.knowledgePrimer.definitions must contain at least three definitions.");
  } else {
    for (const item of primer.definitions) {
      for (const field of ["term", "definition", "distinction"]) string(item?.[field], `monthly topic.knowledgePrimer.definitions[].${field}`, errors);
      oneOf(item?.basis, [...BASIS_VALUES], "monthly topic.knowledgePrimer.definitions[].basis", errors);
    }
  }
  if (!Array.isArray(primer?.mechanisms) || primer.mechanisms.length < 2) {
    errors.push("monthly topic.knowledgePrimer.mechanisms must contain at least two mechanisms.");
  } else {
    for (const item of primer.mechanisms) {
      for (const field of ["title", "explanation", "practicalMeaning"]) string(item?.[field], `monthly topic.knowledgePrimer.mechanisms[].${field}`, errors);
      stringArray(item?.sourceIds, "monthly topic.knowledgePrimer.mechanisms[].sourceIds", 1, errors);
      allowedIds(item?.sourceIds, sourceIds, "monthly topic.knowledgePrimer.mechanisms[].sourceIds", errors);
    }
  }
}

function validateEvidenceSynthesis(items, selectedSourceIds, errors) {
  if (!Array.isArray(items) || items.length < 2) {
    errors.push("monthly topic.evidenceSynthesis must contain at least two complete-source syntheses.");
    return;
  }
  const seen = new Set();
  for (const item of items) {
    string(item?.sourceId, "monthly topic.evidenceSynthesis[].sourceId", errors);
    if (!selectedSourceIds.has(item?.sourceId)) errors.push(`monthly topic.evidenceSynthesis uses unselected source ${item?.sourceId}.`);
    if (seen.has(item?.sourceId)) errors.push(`monthly topic.evidenceSynthesis repeats ${item?.sourceId}.`);
    seen.add(item?.sourceId);
    for (const field of ["studyDesign", "population", "methods", "interpretation"]) string(item?.[field], `monthly topic.evidenceSynthesis[].${field}`, errors);
    if (!EVIDENCE_LEVELS.has(item?.evidenceLevel)) errors.push("monthly topic.evidenceSynthesis[].evidenceLevel is invalid.");
    stringArray(item?.limitations, "monthly topic.evidenceSynthesis[].limitations", 1, errors);
    if (!Array.isArray(item?.quantitativeResults) || item.quantitativeResults.length === 0) {
      errors.push("monthly topic.evidenceSynthesis[].quantitativeResults must contain at least one result.");
    } else {
      for (const result of item.quantitativeResults) {
        for (const field of ["measure", "result", "context", "sourceLocation"]) string(result?.[field], `monthly topic.evidenceSynthesis[].quantitativeResults[].${field}`, errors);
      }
    }
  }
  for (const sourceId of selectedSourceIds) {
    if (!seen.has(sourceId)) errors.push(`monthly topic.evidenceSynthesis is missing ${sourceId}.`);
  }
}

function validateVisualization(visualization, errors) {
  if (visualization === null || visualization === undefined) return;
  exact(visualization?.type, "bar", "monthly topic.visualization.type", errors);
  for (const field of ["title", "caption", "unit", "sourceNote"]) string(visualization?.[field], `monthly topic.visualization.${field}`, errors);
  if (!Array.isArray(visualization?.data) || visualization.data.length < 2) {
    errors.push("monthly topic.visualization.data must contain at least two values.");
    return;
  }
  for (const datum of visualization.data) {
    string(datum?.label, "monthly topic.visualization.data[].label", errors);
    string(datum?.detail, "monthly topic.visualization.data[].detail", errors);
    if (!Number.isFinite(datum?.value) || datum.value < 0) errors.push("monthly topic.visualization.data[].value must be non-negative.");
  }
}

function validateTakeaways(items, errors) {
  if (!Array.isArray(items) || items.length < 3) {
    errors.push("monthly topic.takeaways must contain at least three items.");
    return;
  }
  for (const item of items) {
    string(item?.title, "monthly topic.takeaways[].title", errors);
    string(item?.body, "monthly topic.takeaways[].body", errors);
  }
}

function validateActionProtocol(protocol, errors) {
  for (const field of ["title", "scope", "targetPopulation", "goal"]) string(protocol?.[field], `monthly topic.actionProtocol.${field}`, errors);
  validateTable(protocol?.assessmentTable, "monthly topic.actionProtocol.assessmentTable", errors);
  if (!Array.isArray(protocol?.phases) || protocol.phases.length < 2) {
    errors.push("monthly topic.actionProtocol.phases must contain at least two phases.");
  } else {
    for (const phase of protocol.phases) {
      for (const field of ["phase", "timing", "dosage"]) string(phase?.[field], `monthly topic.actionProtocol.phases[].${field}`, errors);
      for (const field of ["entryCriteria", "actions", "monitoring", "progressionCriteria", "regressionCriteria"]) stringArray(phase?.[field], `monthly topic.actionProtocol.phases[].${field}`, 1, errors);
      oneOf(phase?.evidenceBasis, [...BASIS_VALUES], "monthly topic.actionProtocol.phases[].evidenceBasis", errors);
    }
  }
  for (const field of ["baseline", "progression", "monitoring", "reviewCadence"]) string(protocol?.loadManagement?.[field], `monthly topic.actionProtocol.loadManagement.${field}`, errors);
  if (!Array.isArray(protocol?.stopRules) || protocol.stopRules.length < 2) {
    errors.push("monthly topic.actionProtocol.stopRules must contain at least two rules.");
  } else {
    for (const rule of protocol.stopRules) {
      for (const field of ["trigger", "action", "restartCriteria"]) string(rule?.[field], `monthly topic.actionProtocol.stopRules[].${field}`, errors);
      oneOf(rule?.urgency, [...URGENCY_VALUES], "monthly topic.actionProtocol.stopRules[].urgency", errors);
      oneOf(rule?.evidenceBasis, [...BASIS_VALUES], "monthly topic.actionProtocol.stopRules[].evidenceBasis", errors);
    }
  }
  if (!Array.isArray(protocol?.outcomeTracking) || protocol.outcomeTracking.length < 2) {
    errors.push("monthly topic.actionProtocol.outcomeTracking must contain at least two outcomes.");
  } else {
    for (const item of protocol.outcomeTracking) {
      for (const field of ["domain", "measure", "frequency", "interpretation"]) string(item?.[field], `monthly topic.actionProtocol.outcomeTracking[].${field}`, errors);
    }
  }
}

function validateDecisionPath(items, errors) {
  if (!Array.isArray(items) || items.length < 3) {
    errors.push("monthly topic.decisionPath must contain at least three decisions.");
    return;
  }
  for (const item of items) {
    for (const field of ["stage", "question", "action"]) string(item?.[field], `monthly topic.decisionPath[].${field}`, errors);
    stringArray(item?.signals, "monthly topic.decisionPath[].signals", 2, errors);
  }
}

function validateMetrics(items, errors) {
  if (!Array.isArray(items) || items.length < 3) {
    errors.push("monthly topic.metrics must contain at least three measures.");
    return;
  }
  for (const item of items) for (const field of ["name", "why", "practice"]) string(item?.[field], `monthly topic.metrics[].${field}`, errors);
}

function validateConnections(items, idField, allowed, fields, location, minimum, errors) {
  if (!Array.isArray(items) || items.length < minimum) {
    errors.push(`${location} must contain at least ${minimum} item(s).`);
    return;
  }
  for (const item of items) {
    string(item?.[idField], `${location}[].${idField}`, errors);
    if (allowed.size > 0 && !allowed.has(item?.[idField])) errors.push(`${location} includes unavailable ${item?.[idField]}.`);
    for (const field of fields) string(item?.[field], `${location}[].${field}`, errors);
  }
}

function validateTable(table, location, errors) {
  string(table?.title, `${location}.title`, errors);
  string(table?.sourceNote, `${location}.sourceNote`, errors);
  stringArray(table?.headers, `${location}.headers`, 2, errors);
  if (!Array.isArray(table?.rows) || table.rows.length === 0) {
    errors.push(`${location}.rows must contain at least one row.`);
    return;
  }
  for (const row of table.rows) {
    if (!Array.isArray(row) || row.length !== table.headers?.length || !row.every(nonEmpty)) {
      errors.push(`${location}.rows must match headers and contain non-empty text.`);
      return;
    }
  }
}

function allowedIds(values, allowed, location, errors) {
  if (allowed.size === 0) return;
  for (const value of values ?? []) if (!allowed.has(value)) errors.push(`${location} includes unavailable source ${value}.`);
}

function exact(value, expected, location, errors) {
  if (value !== expected) errors.push(`${location} must be ${expected}.`);
}

function oneOf(value, allowed, location, errors) {
  if (!allowed.includes(value)) errors.push(`${location} must be one of: ${allowed.join(", ")}.`);
}

function string(value, location, errors) {
  if (!nonEmpty(value)) errors.push(`${location} must be a non-empty string.`);
}

function stringArray(value, location, minimum, errors) {
  if (!Array.isArray(value) || value.length < minimum || !value.every(nonEmpty)) errors.push(`${location} must contain at least ${minimum} non-empty strings.`);
}

function uniqueStringArray(value, location, minimum, errors) {
  stringArray(value, location, minimum, errors);
  if (Array.isArray(value) && new Set(value).size !== value.length) errors.push(`${location} must not repeat values.`);
}

function date(value, location, errors) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) errors.push(`${location} must use YYYY-MM-DD.`);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
