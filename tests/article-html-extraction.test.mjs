import test from "node:test";
import assert from "node:assert/strict";
import { extractArticleFromHtml } from "../scripts/lib/article-html-extraction.mjs";

test("accepts a structured full article and preserves tables and figure captions", () => {
  const paragraphs = Array.from({ length: 35 }, (_, index) => `<p>Paragraph ${index + 1}: ${"source-grounded study content ".repeat(10)}</p>`).join("");
  const html = `
    <html><head><meta name="citation_title" content="Training Load Study"></head><body>
      <article>
        <h2>Introduction</h2>${paragraphs.slice(0, Math.floor(paragraphs.length / 3))}
        <h2>Methods</h2>${paragraphs}
        <h2>Results</h2>
        <table><caption>Primary outcome</caption><tr><th>Group</th><th>Value</th></tr><tr><td>A</td><td>12</td></tr></table>
        <figure><figcaption>Change across the intervention period.</figcaption></figure>
        <h2>Discussion</h2>${paragraphs}
      </article>
    </body></html>`;

  const result = extractArticleFromHtml(html, "https://journal.example/article");
  assert.equal(result.ok, true);
  assert.match(result.text, /TABLE 1: Primary outcome/);
  assert.match(result.text, /FIGURE CAPTION:/);
  assert.equal(result.metrics.tableCount, 1);
});

test("rejects an abstract-only access page", () => {
  const html = `<html><body><main><h1>Article</h1><h2>Abstract</h2><p>${"Abstract text. ".repeat(80)}</p><p>Purchase this article to continue.</p></main></body></html>`;
  const result = extractArticleFromHtml(html, "https://journal.example/article");
  assert.equal(result.ok, false);
  assert.notEqual(result.reason, "complete-article-structure");
});
