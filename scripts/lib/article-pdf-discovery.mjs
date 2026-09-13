const PDF_META_NAMES = new Set([
  "citation_pdf_url",
  "dc.identifier.pdf",
  "eprints.document_url",
  "wkhealth_pdf_url"
]);

export function extractPdfCandidates(html, baseUrl) {
  const candidates = [];
  const tags = String(html ?? "").match(/<(?:meta|link|a)\b[^>]*>/giu) ?? [];

  for (const tag of tags) {
    const attributes = parseAttributes(tag);
    const descriptor = `${attributes.name ?? ""} ${attributes.property ?? ""}`.toLocaleLowerCase("en");
    const type = String(attributes.type ?? "").toLocaleLowerCase("en");
    const relationship = String(attributes.rel ?? "").toLocaleLowerCase("en");
    const rawUrl = attributes.content ?? attributes.href;
    if (!rawUrl) continue;

    const isPdfMetadata = PDF_META_NAMES.has(descriptor.trim());
    const isPdfLink = type.includes("application/pdf") || relationship.split(/\s+/u).includes("alternate") && /\.pdf(?:$|[?#])/iu.test(rawUrl);
    const looksLikePdfLink = /(?:\.pdf(?:$|[?#])|\/pdf(?:\/|$|[?#])|[?&](?:download|type)=pdf(?:&|$))/iu.test(rawUrl);
    const isSupplement = /supp(?:lement|orting)|appendix|additional[-_ ]file/iu.test(`${rawUrl} ${attributes.title ?? ""}`);

    if ((isPdfMetadata || isPdfLink || looksLikePdfLink) && !isSupplement) {
      const resolved = resolveHttpUrl(decodeHtmlEntities(rawUrl), baseUrl);
      if (resolved) candidates.push(resolved);
    }
  }

  return unique(candidates);
}

export function derivePublisherPdfCandidates(landingUrl, doi = "") {
  const candidates = [];
  let url;
  try {
    url = new URL(landingUrl);
  } catch {
    return candidates;
  }

  const normalizedDoi = String(doi ?? "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "");
  const host = url.hostname.toLocaleLowerCase("en");

  if (normalizedDoi && /(tandfonline\.com|sagepub\.com|physiology\.org)$/u.test(host)) {
    candidates.push(`${url.origin}/doi/pdf/${normalizedDoi}`);
  }
  if (normalizedDoi && /wiley\.com$/u.test(host)) {
    candidates.push(`${url.origin}/doi/pdfdirect/${normalizedDoi}`);
    candidates.push(`${url.origin}/doi/pdf/${normalizedDoi}`);
  }
  if (normalizedDoi && /springer\.com$/u.test(host)) {
    candidates.push(`${url.origin}/content/pdf/${normalizedDoi}.pdf`);
  }
  if (/bmj\.com$/u.test(host) && !url.pathname.endsWith(".full.pdf")) {
    candidates.push(`${url.origin}${url.pathname}.full.pdf`);
  }

  return unique(candidates);
}

export function isPdfPayload(bytes, contentType = "") {
  const prefix = Buffer.from(bytes).subarray(0, 5).toString("ascii");
  const normalizedType = String(contentType).split(";", 1)[0].trim();
  return prefix === "%PDF-" && !/text\/html|json|xml/iu.test(normalizedType);
}

function parseAttributes(tag) {
  const attributes = {};
  const expression = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu;
  for (const match of tag.matchAll(expression)) {
    attributes[match[1].toLocaleLowerCase("en")] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function resolveHttpUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    return /^https?:$/u.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/gu, (_, codePoint) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/giu, (_, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
