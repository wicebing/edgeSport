import test from "node:test";
import assert from "node:assert/strict";
import { validateYouTubeVideoPlan } from "../scripts/lib/youtube-video-plan.mjs";

const reportUrl = "https://wicebing.github.io/edgeSport/?report=2026-w38#weekly-reports";
const sourceUrl = "https://doi.org/10.1000/example";
const episode = {
  id: "2026-w38",
  showName: "edgeSport4Podcast",
  chapters: [{ turnStart: 1 }, { turnStart: 7 }, { turnStart: 15 }, { turnStart: 23 }],
  researchSources: [{ recordId: "pmid-1", sourceUrl }]
};
const plan = {
  schemaVersion: 1,
  status: "draft",
  episodeId: "2026-w38",
  showName: "edgeSport4Podcast",
  youtubeTitle: "A better evidence question | edgeSport4Podcast",
  youtubeDescription: `A careful discussion of sports-science evidence, methods, uncertainty and practical boundaries. Read the written report at ${reportUrl}. The original research is available at ${sourceUrl}. This episode is educational and uses synthetic speech for both podcast voices.`,
  thumbnailHeadline: "Ask a better evidence question",
  visualDirection: "Use restrained chapter cards, high-contrast transcript text and the YABILAB watermark.",
  segments: [1, 7, 15, 23].map((chapterTurnStart) => ({ chapterTurnStart, headline: `Chapter ${chapterTurnStart}`, supportingLine: "Keep the evidence boundary visible.", accent: "lime" })),
  tags: ["sports science", "sports medicine", "evidence", "podcast", "training"],
  pinnedComment: `Which limitation changes your next question? Read the evidence tables at ${reportUrl}.`,
  disclosure: "This educational podcast video uses synthetic speech generated from supplied local voice samples."
};

test("accepts a complete source-bounded YouTube upload plan", () => {
  assert.deepEqual(validateYouTubeVideoPlan(plan, episode, { reportUrl }), []);
});

test("rejects missing chapter segments and public links", () => {
  const invalid = { ...plan, youtubeDescription: "This description is intentionally incomplete but long enough to enter validation. It omits all required public evidence links and should therefore fail before any video is rendered. The remainder of this sentence only satisfies the basic character threshold.", segments: plan.segments.slice(1), pinnedComment: "A long comment without the required report link should fail validation." };
  const errors = validateYouTubeVideoPlan(invalid, episode, { reportUrl }).join("\n");
  assert.match(errors, /exactly one segment/u);
  assert.match(errors, /public written report/u);
  assert.match(errors, /link source/u);
});
