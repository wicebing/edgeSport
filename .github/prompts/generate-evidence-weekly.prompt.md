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

Include exactly one `articleDigest` for every selected record. For every study, extract a structured `studyProfile` (design, population, intervention/exposure, comparator, outcomes, and follow-up) and source-grounded `quantitativeResults` with enough context to interpret each number. Every digest must contain an original `evidenceTable`. Include a `visualization` only when the supplied source states at least two directly comparable numeric values; otherwise set it to `null`. If at least one source has an eligible comparison, create at least one original bar visualization and state its population, denominator, comparison, and interpretive boundary. Never estimate values from a figure or reproduce an original source table, image, caption, or course slide.

The report must be more than an abstract roundup. Build a `researchLandscape` that groups this week's signals and surfaces traceable key numbers; a `knowledgePrimer` that defines the concepts and mechanisms readers need; a detailed `practiceGuide` with an assessment battery, at least two implementation phases, entry/progression/regression criteria, dosage, load management, stop/referral rules, outcome tracking, risks, and uncertainties; and a `decisionPathway` with actionable yes/no branches. Clearly label whether operational guidance is source-stated, supported by inClass, synthesized across sources, an EDGE SPORT proposal, or mixed. Do not invent universal timelines, cutoffs, injury-risk percentages, or progression rates when the supplied evidence does not establish them. In that situation, prescribe a transparent monitored decision process and state the uncertainty.

Return a short summary after writing the private draft, including the number of full-text-web, full-text-local, full-text-open, and abstract-only sources used. Leave `editorReview.approvedForPublish` as `false`.
