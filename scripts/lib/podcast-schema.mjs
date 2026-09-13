const SPEAKERS = new Set(["host", "cohost"]);
const DELIVERIES = new Set(["warm", "curious", "reflective", "clear", "light", "cautious", "encouraging"]);

export function validatePodcastScript(script, context = {}) {
  const errors = [];
  const availableSources = new Set(context.sourceRecordIds ?? []);
  exact(script?.schemaVersion, 1, "podcast.schemaVersion", errors);
  text(script?.id, "podcast.id", errors);
  if (!/^\d{4}-w\d{2}$/u.test(script?.id ?? "")) errors.push("podcast.id must use YYYY-wNN.");
  exact(script?.status, "draft", "podcast.status", errors);
  date(script?.publishDate, "podcast.publishDate", errors);
  for (const field of ["showName", "episodeTitle", "episodeSubtitle", "summary", "sourceWeeklyReportId", "disclosure"]) text(script?.[field], `podcast.${field}`, errors);
  exact(script?.language, "en", "podcast.language", errors);
  if (!Number.isInteger(script?.estimatedMinutes) || script.estimatedMinutes < 10 || script.estimatedMinutes > 22) errors.push("podcast.estimatedMinutes must be 10-22.");
  validateHosts(script?.hosts, errors);
  stringArray(script?.sourceRecordIds, "podcast.sourceRecordIds", 2, errors);
  allowedIds(script?.sourceRecordIds, availableSources, "podcast.sourceRecordIds", errors);
  if (availableSources.size > 0 && !sameSet(script?.sourceRecordIds ?? [], [...availableSources])) errors.push("podcast.sourceRecordIds must include every research source from the weekly report.");
  stringArray(script?.learningGoals, "podcast.learningGoals", 3, errors);
  stringArray(script?.showNotes, "podcast.showNotes", 4, errors);
  validateDialogue(script?.dialogue, availableSources, errors);
  const openingText = (script?.dialogue ?? []).slice(0, 2).map((turn) => turn?.text ?? "").join(" ");
  if (script?.showName && !openingText.includes(script.showName)) errors.push("podcast.dialogue must introduce the exact showName in the first two turns.");
  validateChapters(script?.chapters, script?.dialogue?.length ?? 0, errors);
  validateFactCheck(script?.factCheck, availableSources, errors);
  stringArray(script?.closingTakeaways, "podcast.closingTakeaways", 3, errors);
  if (script?.editorReview?.approvedForPublish !== false || script?.editorReview?.verifiedBy !== "" || script?.editorReview?.verifiedAt !== "") errors.push("podcast.editorReview must remain unapproved for an automated draft.");
  return errors;
}

export function validatePublishedPodcast(episode, context = {}) {
  const scriptLike = {
    ...episode,
    status: "draft",
    episodeTitle: episode?.title,
    dialogue: (episode?.transcript ?? []).map(({ startSeconds, durationSeconds, ...turn }) => turn)
  };
  const errors = validatePodcastScript(scriptLike, context);
  if (episode?.status !== "published") errors.push("podcast episode.status must be published.");
  if (!Number.isFinite(episode?.durationSeconds) || episode.durationSeconds < 480 || episode.durationSeconds > 1800) errors.push("podcast episode.durationSeconds must be 480-1800.");
  if (!Number.isInteger(episode?.wordCount) || episode.wordCount < 1400) errors.push("podcast episode.wordCount must reflect the validated transcript.");
  if (!/^assets\/podcasts\/\d{4}-w\d{2}(?:-[a-f0-9]{12})?\.mp3$/u.test(episode?.audio?.src ?? "")) errors.push("podcast episode.audio.src must use assets/podcasts/YYYY-wNN[-contenthash].mp3.");
  if (episode?.audio?.mimeType !== "audio/mpeg") errors.push("podcast episode.audio.mimeType must be audio/mpeg.");
  if (!Number.isInteger(episode?.audio?.bytes) || episode.audio.bytes < 1000) errors.push("podcast episode.audio.bytes must be a positive file size.");
  if (!Array.isArray(episode?.transcript) || episode.transcript.some((turn) => !Number.isFinite(turn.startSeconds) || !Number.isFinite(turn.durationSeconds))) errors.push("podcast episode.transcript must contain rendered timing for every turn.");
  if (!Array.isArray(episode?.chapters) || episode.chapters.some((chapter) => !Number.isFinite(chapter.startSeconds))) errors.push("podcast episode.chapters must contain rendered start times.");
  return errors;
}

function validateHosts(hosts, errors) {
  if (!Array.isArray(hosts) || hosts.length !== 2) {
    errors.push("podcast.hosts must contain host and cohost.");
    return;
  }
  const ids = new Set();
  for (const host of hosts) {
    if (!SPEAKERS.has(host?.id)) errors.push("podcast.hosts[].id must be host or cohost.");
    text(host?.displayName, "podcast.hosts[].displayName", errors);
    text(host?.role, "podcast.hosts[].role", errors);
    ids.add(host?.id);
  }
  if (ids.size !== 2) errors.push("podcast.hosts must contain one host and one cohost.");
}

function validateDialogue(turns, availableSources, errors) {
  if (!Array.isArray(turns) || turns.length < 26 || turns.length > 50) {
    errors.push("podcast.dialogue must contain 26-50 turns.");
    return;
  }
  let alternations = 0;
  const speakerCounts = { host: 0, cohost: 0 };
  let wordCount = 0;
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn?.turn !== index + 1) errors.push(`podcast.dialogue[${index}].turn must be ${index + 1}.`);
    if (!SPEAKERS.has(turn?.speaker)) errors.push(`podcast.dialogue[${index}].speaker is invalid.`);
    else speakerCounts[turn.speaker] += 1;
    text(turn?.text, `podcast.dialogue[${index}].text`, errors);
    if (String(turn?.text ?? "").length > 760) errors.push(`podcast.dialogue[${index}].text is too long for stable TTS.`);
    wordCount += String(turn?.text ?? "").trim().split(/\s+/u).filter(Boolean).length;
    if (!DELIVERIES.has(turn?.delivery)) errors.push(`podcast.dialogue[${index}].delivery is invalid.`);
    if (!Array.isArray(turn?.evidenceSourceIds)) errors.push(`podcast.dialogue[${index}].evidenceSourceIds must be an array.`);
    else allowedIds(turn.evidenceSourceIds, availableSources, `podcast.dialogue[${index}].evidenceSourceIds`, errors);
    if (index > 0 && turns[index - 1]?.speaker !== turn?.speaker) alternations += 1;
  }
  if (alternations / (turns.length - 1) < 0.8) errors.push("podcast.dialogue must read as a balanced conversation with at least 80% speaker alternation.");
  if (Math.abs(speakerCounts.host - speakerCounts.cohost) > 3) errors.push("podcast.dialogue speaker turns are not balanced.");
  if (wordCount < 1400 || wordCount > 2700) errors.push(`podcast.dialogue must contain 1400-2700 English words; found ${wordCount}.`);
}

function validateChapters(chapters, turnCount, errors) {
  if (!Array.isArray(chapters) || chapters.length < 4 || chapters.length > 8) {
    errors.push("podcast.chapters must contain 4-8 chapters.");
    return;
  }
  let previous = 0;
  for (const chapter of chapters) {
    text(chapter?.title, "podcast.chapters[].title", errors);
    text(chapter?.summary, "podcast.chapters[].summary", errors);
    if (!Number.isInteger(chapter?.turnStart) || chapter.turnStart < 1 || chapter.turnStart > turnCount) errors.push("podcast.chapters[].turnStart must reference a dialogue turn.");
    if (chapter?.turnStart <= previous) errors.push("podcast.chapters must have increasing turnStart values.");
    previous = chapter?.turnStart ?? previous;
  }
  if (chapters[0]?.turnStart !== 1) errors.push("podcast.chapters must begin at turn 1.");
}

function validateFactCheck(items, availableSources, errors) {
  if (!Array.isArray(items) || items.length < 5) {
    errors.push("podcast.factCheck must contain at least five traceable claims.");
    return;
  }
  for (const item of items) {
    text(item?.claim, "podcast.factCheck[].claim", errors);
    text(item?.boundary, "podcast.factCheck[].boundary", errors);
    stringArray(item?.evidenceSourceIds, "podcast.factCheck[].evidenceSourceIds", 1, errors);
    allowedIds(item?.evidenceSourceIds, availableSources, "podcast.factCheck[].evidenceSourceIds", errors);
  }
}

function allowedIds(values, allowed, location, errors) {
  if (allowed.size === 0) return;
  for (const value of values ?? []) if (!allowed.has(value)) errors.push(`${location} includes unavailable source ${value}.`);
}

function sameSet(left, right) {
  return left.length === right.length && new Set(left).size === left.length && left.every((value) => right.includes(value));
}

function exact(value, expected, location, errors) {
  if (value !== expected) errors.push(`${location} must be ${expected}.`);
}

function text(value, location, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${location} must be a non-empty string.`);
}

function stringArray(value, location, minimum, errors) {
  if (!Array.isArray(value) || value.length < minimum || !value.every((item) => typeof item === "string" && item.trim())) errors.push(`${location} must contain at least ${minimum} non-empty strings.`);
}

function date(value, location, errors) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value ?? "")) errors.push(`${location} must use YYYY-MM-DD.`);
}
