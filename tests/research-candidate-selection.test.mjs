import test from "node:test";
import assert from "node:assert/strict";
import { buildResearchCandidatePool } from "../scripts/lib/research-candidate-selection.mjs";

const coverage = { from: "2026-11-11", to: "2026-11-17" };
const records = [
  record("current", "2026-11-16", ["運動醫學"]),
  record("recent-fallback", "2026-11-04", ["運動醫學"]),
  record("already-reported", "2026-11-03", ["運動醫學"]),
  record("too-old", "2026-10-01", ["運動醫學"]),
  record("wrong-theme", "2026-11-05", ["營養與恢復"])
];

test("normal weekly selection stays inside the current collection coverage", () => {
  const selected = buildResearchCandidatePool(records, {
    coverage,
    previouslyReportedRecordIds: new Set(["already-reported"])
  });
  assert.deepEqual(selected.map((item) => item.id), ["current"]);
});

test("full-text selection can fill from recent unreported candidates", () => {
  const selected = buildResearchCandidatePool(records, {
    coverage,
    previouslyReportedRecordIds: new Set(["already-reported"]),
    requestedTheme: "運動醫學",
    fullTextOnly: true,
    fullTextLookbackDays: 28
  });
  assert.deepEqual(selected.map((item) => item.id), ["current", "recent-fallback"]);
});

function record(id, publicationDate, themes) {
  return { id, publicationDate, themes, title: id };
}
