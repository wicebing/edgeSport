import * as cheerio from "cheerio";

const ARTICLE_SELECTORS = [
  "article",
  "#article-body",
  ".article-body",
  ".article__body",
  ".article-full-text",
  ".fulltext-view",
  ".full-text",
  "[role='main']",
  "main"
];

const CORE_SECTION_PATTERNS = [
  /\b(?:introduction|background)\b/iu,
  /\b(?:methods?|methodology|materials and methods)\b/iu,
  /\bresults?\b/iu,
  /\bdiscussion\b/iu,
  /\bconclusions?\b/iu,
  /\blimitations?\b/iu
];

export function extractArticleFromHtml(html, sourceUrl) {
  const $ = cheerio.load(String(html ?? ""));
  const accessSignals = detectAccessSignals($);
  $("script,style,noscript,template,svg,canvas,iframe,form,button,nav,header,footer,aside").remove();
  $(".advertisement,.ad,.cookie-banner,.social-share,.related-content,.recommendations").remove();

  const title = normalizeText(
    $("meta[name='citation_title']").attr("content")
      ?? $("meta[property='og:title']").attr("content")
      ?? $("h1").first().text()
      ?? $("title").text()
  );
  const candidate = chooseBestContainer($);
  if (!candidate) {
    return { ok: false, reason: "no-article-container", title, text: "", metrics: emptyMetrics() };
  }

  const root = candidate.element.clone();
  root.find("script,style,noscript,template,svg,canvas,iframe,form,button,nav,header,footer,aside").remove();
  const headings = root.find("h1,h2,h3,h4")
    .map((_, element) => normalizeText($(element).text()))
    .get()
    .filter(Boolean);
  const sectionCount = CORE_SECTION_PATTERNS.filter((pattern) => headings.some((heading) => pattern.test(heading))).length;
  const paragraphCount = root.find("p").filter((_, element) => normalizeText($(element).text()).length >= 40).length;
  const tableCount = root.find("table").length;
  const figureCaptionCount = root.find("figcaption,.fig-caption,.figure-caption").length;

  root.find("table").each((tableIndex, element) => {
    const tableText = renderTable($, $(element), tableIndex + 1);
    $(element).replaceWith(`<pre data-edge-sport-table="true">${escapeHtml(tableText)}</pre>`);
  });

  const blocks = [];
  root.find("h1,h2,h3,h4,p,li,pre[data-edge-sport-table='true'],figcaption,.fig-caption,.figure-caption").each((_, element) => {
    const node = $(element);
    if (element.tagName === "li" && node.children("p").length > 0) return;
    const text = normalizeText(node.text());
    if (!text || blocks.at(-1) === text) return;
    const tagName = String(element.tagName ?? "").toLocaleLowerCase("en");
    if (/^h[1-4]$/u.test(tagName)) blocks.push(`\n${text.toLocaleUpperCase("en")}\n`);
    else if (tagName === "figcaption" || node.hasClass("fig-caption") || node.hasClass("figure-caption")) blocks.push(`FIGURE CAPTION: ${text}`);
    else blocks.push(text);
  });

  const text = normalizeDocument([title ? `TITLE\n${title}` : "", ...blocks].filter(Boolean).join("\n\n"));
  const metrics = {
    characterCount: text.length,
    paragraphCount,
    sectionCount,
    tableCount,
    figureCaptionCount,
    selector: candidate.selector
  };
  const fullTextStructure = sectionCount >= 2 || paragraphCount >= 25;
  const likelyFullText = text.length >= 6500 && fullTextStructure;
  const accessWall = text.length < 15000 && accessSignals;

  return {
    ok: likelyFullText && !accessWall,
    reason: accessWall ? "access-wall-or-login" : likelyFullText ? "complete-article-structure" : "insufficient-full-text-structure",
    sourceUrl,
    title,
    text,
    metrics
  };
}

function chooseBestContainer($) {
  const candidates = [];
  for (const selector of ARTICLE_SELECTORS) {
    $(selector).each((_, element) => {
      const node = $(element);
      const textLength = normalizeText(node.text()).length;
      if (textLength < 1000) return;
      const score = textLength
        + node.find("p").length * 80
        + node.find("h2,h3").length * 180
        + node.find("table").length * 400;
      candidates.push({ selector, element: node, score });
    });
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] ?? null;
}

function renderTable($, table, index) {
  const caption = normalizeText(table.find("caption").first().text());
  const rows = table.find("tr").map((_, row) => {
    const cells = $(row).children("th,td").map((__, cell) => normalizeText($(cell).text())).get();
    return cells.length > 0 ? `| ${cells.join(" | ")} |` : "";
  }).get().filter(Boolean);
  return [`TABLE ${index}${caption ? `: ${caption}` : ""}`, ...rows].join("\n");
}

function detectAccessSignals($) {
  const pageText = normalizeText($("body").text()).toLocaleLowerCase("en");
  const hasPassword = $("input[type='password']").length > 0;
  const wallLanguage = /(?:purchase|buy|rent|get) (?:this )?(?:article|access)|institutional sign in|access through your institution|subscribe to read|you do not have access|access denied/iu.test(pageText);
  return hasPassword || wallLanguage;
}

function emptyMetrics() {
  return { characterCount: 0, paragraphCount: 0, sectionCount: 0, tableCount: 0, figureCaptionCount: 0, selector: null };
}

function normalizeText(value) {
  return String(value ?? "").replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim();
}

function normalizeDocument(value) {
  return String(value ?? "")
    .replace(/\r/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
