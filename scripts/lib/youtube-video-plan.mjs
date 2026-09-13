export function validateYouTubeVideoPlan(plan, episode, context = {}) {
  const errors = [];
  if (plan?.schemaVersion !== 1) errors.push("youtube plan.schemaVersion must be 1.");
  if (plan?.status !== "draft") errors.push("youtube plan.status must be draft.");
  if (plan?.episodeId !== episode?.id) errors.push("youtube plan.episodeId must match the podcast episode.");
  if (plan?.showName !== episode?.showName) errors.push("youtube plan.showName must match the podcast showName.");
  boundedText(plan?.youtubeTitle, "youtube plan.youtubeTitle", 12, 100, errors);
  if (!String(plan?.youtubeTitle ?? "").includes(episode?.showName ?? "")) errors.push("youtube plan.youtubeTitle must contain the exact showName.");
  boundedText(plan?.youtubeDescription, "youtube plan.youtubeDescription", 200, 5000, errors);
  boundedText(plan?.thumbnailHeadline, "youtube plan.thumbnailHeadline", 8, 70, errors);
  boundedText(plan?.visualDirection, "youtube plan.visualDirection", 30, 500, errors);
  boundedText(plan?.pinnedComment, "youtube plan.pinnedComment", 40, 800, errors);
  boundedText(plan?.disclosure, "youtube plan.disclosure", 30, 500, errors);
  const expectedStarts = (episode?.chapters ?? []).map((chapter) => chapter.turnStart);
  const actualStarts = (plan?.segments ?? []).map((segment) => segment.chapterTurnStart);
  if (!Array.isArray(plan?.segments) || plan.segments.length !== expectedStarts.length || !sameSet(actualStarts, expectedStarts)) {
    errors.push("youtube plan.segments must contain exactly one segment for every podcast chapter.");
  }
  for (const [index, segment] of (plan?.segments ?? []).entries()) {
    boundedText(segment?.headline, `youtube plan.segments[${index}].headline`, 5, 75, errors);
    boundedText(segment?.supportingLine, `youtube plan.segments[${index}].supportingLine`, 10, 150, errors);
  }
  if (!Array.isArray(plan?.tags) || plan.tags.length < 5 || plan.tags.length > 15 || plan.tags.some((tag) => typeof tag !== "string" || tag.length < 2 || tag.length > 40)) {
    errors.push("youtube plan.tags must contain 5-15 concise tags.");
  }
  for (const source of episode?.researchSources ?? []) {
    if (!String(plan?.youtubeDescription ?? "").includes(source.sourceUrl)) errors.push(`youtube plan.youtubeDescription must link source ${source.recordId}.`);
  }
  if (context.reportUrl && !String(plan?.youtubeDescription ?? "").includes(context.reportUrl)) errors.push("youtube plan.youtubeDescription must link the public written report.");
  if (context.reportUrl && !String(plan?.pinnedComment ?? "").includes(context.reportUrl)) errors.push("youtube plan.pinnedComment must link the public written report.");
  if (!/synthetic/iu.test(plan?.disclosure ?? "")) errors.push("youtube plan.disclosure must identify synthetic speech.");
  return errors;
}

function boundedText(value, location, minimum, maximum, errors) {
  if (typeof value !== "string" || value.trim().length < minimum || value.length > maximum) errors.push(`${location} must be ${minimum}-${maximum} characters.`);
}

function sameSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && left.every((value) => right.includes(value));
}
