import test from "node:test";
import assert from "node:assert/strict";
import { validatePodcastScript, validatePublishedPodcast } from "../scripts/lib/podcast-schema.mjs";

const sourceRecordIds = ["pmid-101", "pmid-202"];
const spokenSentence = "The weekly evidence reminds us to compare individual trends with symptoms, workload context, measurement error, and study limits before changing practice.";
const dialogue = Array.from({ length: 40 }, (_, index) => ({
  turn: index + 1,
  speaker: index % 2 === 0 ? "host" : "cohost",
  text: `${index === 0 ? "This is edgeSport4Podcast. " : ""}${index % 4 < 2 ? "What would change your decision? " : "How would you explain that limit? "}${spokenSentence}${index % 6 === 0 ? "" : ` ${spokenSentence}`}`,
  delivery: index % 2 === 0 ? "clear" : "curious",
  evidenceSourceIds: [sourceRecordIds[index % sourceRecordIds.length]]
}));

const draft = {
  schemaVersion: 1,
  id: "2026-w38",
  status: "draft",
  publishDate: "2026-09-19",
  showName: "edgeSport4Podcast",
  episodeTitle: "Read the trend, not one number",
  episodeSubtitle: "A careful conversation about this week's evidence",
  summary: "Two hosts connect research methods, important numbers, limitations and practical decisions.",
  language: "en",
  estimatedMinutes: 14,
  hosts: [
    { id: "host", displayName: "Ying", role: "Evidence guide · female voice" },
    { id: "cohost", displayName: "Bing", role: "Analytical partner · male voice" }
  ],
  sourceWeeklyReportId: "2026-w38",
  sourceRecordIds,
  learningGoals: ["Interpret trends", "Respect uncertainty", "Plan the next measurement"],
  showNotes: ["Weekly report", "Methods", "Practical meaning", "Safety boundary"],
  chapters: [
    { title: "Opening", summary: "Set the central question.", turnStart: 1 },
    { title: "Evidence", summary: "Examine the studies.", turnStart: 7 },
    { title: "Practice", summary: "Translate the findings.", turnStart: 15 },
    { title: "Close", summary: "Name the takeaways.", turnStart: 31 }
  ],
  dialogue,
  factCheck: Array.from({ length: 5 }, (_, index) => ({
    claim: `Traceable claim ${index + 1}`,
    evidenceSourceIds: [sourceRecordIds[index % sourceRecordIds.length]],
    boundary: "The source supports an association, not an individual diagnosis."
  })),
  closingTakeaways: ["Track the person", "Check the context", "Escalate when symptoms warrant it"],
  disclosure: "This educational episode uses synthetic speech and is not individualized medical advice.",
  editorReview: { approvedForPublish: false, verifiedBy: "", verifiedAt: "" }
};

test("accepts a balanced, source-complete podcast script", () => {
  assert.deepEqual(validatePodcastScript(draft, { sourceRecordIds, requireNaturalDialogue: true }), []);
});

test("rejects a script that omits a weekly-report source", () => {
  const incomplete = { ...draft, sourceRecordIds: [sourceRecordIds[0]] };
  assert.match(validatePodcastScript(incomplete, { sourceRecordIds }).join("\n"), /must include every research source/u);
});

test("accepts a rendered public episode with transcript timing", () => {
  const episode = {
    ...draft,
    status: "published",
    title: draft.episodeTitle,
    durationSeconds: 840,
    wordCount: dialogue.reduce((total, turn) => total + turn.text.split(/\s+/u).length, 0),
    transcript: dialogue.map((turn, index) => ({ ...turn, startSeconds: index * 31, durationSeconds: 30 })),
    chapters: draft.chapters.map((chapter) => ({ ...chapter, startSeconds: (chapter.turnStart - 1) * 31 })),
    audio: { src: "assets/podcasts/2026-w38-123456abcdef.mp3", mimeType: "audio/mpeg", bytes: 10_000 }
  };
  assert.deepEqual(validatePublishedPodcast(episode, { sourceRecordIds }), []);
});
