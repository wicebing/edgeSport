import test from "node:test";
import assert from "node:assert/strict";
import { derivePublisherPdfCandidates, extractPdfCandidates, isPdfPayload } from "../scripts/lib/article-pdf-discovery.mjs";

test("discovers official citation PDF metadata and resolves relative URLs", () => {
  const html = `
    <meta content="/articles/main.pdf?download=1&amp;source=page" name="citation_pdf_url">
    <a href="supplement-file.pdf">Supplement</a>
  `;

  assert.deepEqual(extractPdfCandidates(html, "https://journal.example.org/article/123"), [
    "https://journal.example.org/articles/main.pdf?download=1&source=page"
  ]);
});

test("derives common publisher PDF routes without inventing a DOI", () => {
  const candidates = derivePublisherPdfCandidates(
    "https://onlinelibrary.wiley.com/doi/10.1002/ksa.70589",
    "10.1002/ksa.70589"
  );

  assert.ok(candidates.includes("https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/ksa.70589"));
  assert.ok(candidates.includes("https://onlinelibrary.wiley.com/doi/pdf/10.1002/ksa.70589"));
});

test("accepts only a real PDF signature and rejects HTML login pages", () => {
  assert.equal(isPdfPayload(Buffer.from("%PDF-1.7 test"), "application/pdf"), true);
  assert.equal(isPdfPayload(Buffer.from("<html>login</html>"), "application/pdf"), false);
  assert.equal(isPdfPayload(Buffer.from("%PDF-1.7 test"), "text/html"), false);
});
