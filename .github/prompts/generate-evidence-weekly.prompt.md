---
name: "Generate Evidence Weekly"
description: "Use when: creating a Traditional Chinese sports science weekly report from a local EDGE SPORT research packet"
argument-hint: "Provide the private research packet path and target draft path"
agent: "agent"
tools: ["read", "edit"]
---

Create one JSON weekly-report draft from the user-provided EDGE SPORT private research packet.

Read the packet and every complete web/local/open full-text extraction path it names. Write the result only to the user-provided private `research-library/weekly-drafts/<week>.json` path. Do not write to `content/`, do not publish, and do not copy original webpage/PDF text, tables, figures, captions, or course material.

Follow the packet's `authoringRules` exactly. Retain each source's declared content level. For `abstract-only` sources, only summarize abstract-stated facts and state that the conclusions require full-text checking. For each article, use only the listed `inClassMatches` and `priorIssueMatches`; when none applies, say so rather than inventing a comparison.

Include exactly one `articleDigest` for every selected record. Every digest must contain an original `evidenceTable`. Include a `visualization` only when the supplied source states at least two directly comparable numeric values; otherwise set it to `null`. Never estimate values from a figure or reproduce an original source table, image, caption, or course slide.

Return a short summary after writing the private draft, including the number of full-text-web, full-text-local, full-text-open, and abstract-only sources used. Leave `editorReview.approvedForPublish` as `false`.
