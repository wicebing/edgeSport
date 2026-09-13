export const DOMAIN_CONCEPTS = [
  {
    id: "knee-acl",
    label: "ACL / 膝關節",
    terms: ["anterior cruciate", "acl", "knee", "patella", "patellar", "meniscus", "膝", "前十字", "髕", "半月板"]
  },
  {
    id: "ankle-foot",
    label: "足踝",
    terms: ["ankle", "achilles", "foot", "plantar", "lateral ankle", "chronic ankle instability", "cai", "踝", "足", "阿基里斯"]
  },
  {
    id: "shoulder-elbow",
    label: "肩與上肢",
    terms: ["shoulder", "elbow", "rotator cuff", "scapular", "pitching", "throwing", "upper extremity", "肩", "肘", "肩胛", "投球"]
  },
  {
    id: "spine-trunk",
    label: "脊椎與軀幹",
    terms: ["spine", "lumbar", "cervical", "trunk", "low back", "腰椎", "頸椎", "脊椎", "軀幹"]
  },
  {
    id: "concussion",
    label: "腦震盪",
    terms: ["concussion", "brain injury", "head impact", "腦震盪", "腦傷"]
  },
  {
    id: "training-load",
    label: "訓練負荷",
    terms: ["training load", "workload", "load monitoring", "periodization", "periodisation", "training volume", "訓練負荷", "週期化", "訓練量", "疲勞監測"]
  },
  {
    id: "strength-power",
    label: "肌力與爆發力",
    terms: ["strength", "resistance training", "power", "plyometric", "jump", "eccentric", "isometric", "肌力", "爆發力", "增強式", "跳躍", "離心", "等長"]
  },
  {
    id: "nutrition-hydration",
    label: "營養與水合",
    terms: ["nutrition", "diet", "hydration", "fluid", "carbohydrate", "protein", "electrolyte", "營養", "水分", "補水", "碳水", "蛋白質", "電解質"]
  },
  {
    id: "heat-environment",
    label: "熱環境",
    terms: ["heat", "thermal", "thermoregulation", "hot environment", "heat illness", "高溫", "熱環境", "中暑", "體溫"]
  },
  {
    id: "assessment-biomechanics",
    label: "評估與生物力學",
    terms: ["force plate", "biomechanic", "motion analysis", "dynamometer", "countermovement", "cmj", "assessment", "測力板", "生物力學", "肌力評估", "動作分析"]
  },
  {
    id: "monitoring-technology",
    label: "監測與科技",
    terms: ["wearable", "imu", "sensor", "gps", "technology", "monitoring", "inertial", "穿戴", "感測", "監測", "運動科技", "慣性"]
  },
  {
    id: "women-health",
    label: "女性運動員健康",
    terms: ["female athlete", "women athlete", "menstrual", "pregnancy", "female athlete triad", "女性運動員", "月經", "女性健康"]
  },
  {
    id: "baseball",
    label: "棒球",
    terms: ["baseball", "pitcher", "pitching", "ball player", "棒球", "投手", "投球"]
  },
  {
    id: "soccer",
    label: "足球",
    terms: ["soccer", "football", "fifa", "足球"]
  },
  {
    id: "basketball",
    label: "籃球",
    terms: ["basketball", "籃球"]
  },
  {
    id: "running-endurance",
    label: "跑步與耐力",
    terms: ["running", "runner", "marathon", "endurance", "triathlon", "cycling", "跑步", "馬拉松", "耐力", "鐵人", "自行車"]
  },
  {
    id: "return-to-sport",
    label: "傷後回場",
    terms: ["return to sport", "return to play", "return to performance", "rehabilitation", "reinjury", "return to", "回場", "復健", "傷後"]
  },
  {
    id: "medical-imaging-surgery",
    label: "影像與手術",
    terms: ["mri", "imaging", "surgery", "surgical", "reconstruction", "arthroscopy", "磁振", "影像", "手術", "重建", "關節鏡"]
  }
];

export function identifyConcepts(...values) {
  const text = normaliseText(values.filter(Boolean).join(" "));
  if (!text) {
    return [];
  }

  return DOMAIN_CONCEPTS
    .map((concept) => {
      const hits = concept.terms.filter((term) => text.includes(term.toLocaleLowerCase("en")));
      return hits.length > 0 ? { id: concept.id, label: concept.label, hits } : null;
    })
    .filter(Boolean);
}

export function rankKnowledgeMatches(target, candidates, options = {}) {
  const maximumMatches = options.maximumMatches ?? 3;
  const targetText = normaliseText([target.title, target.abstract, target.text, ...(target.themes ?? [])].filter(Boolean).join(" "));
  const targetConcepts = identifyConcepts(targetText);
  const targetTokens = extractTokens(targetText);

  return candidates
    .map((candidate) => {
      const candidateText = normaliseWhitespace([
        candidate.title,
        candidate.summary,
        candidate.excerpt,
        ...(candidate.headings ?? [])
      ].filter(Boolean).join(" "));
      const candidateConcepts = identifyConcepts(candidateText);
      const candidateTokens = extractTokens(candidateText);
      const sharedConcepts = targetConcepts
        .filter((targetConcept) => candidateConcepts.some((candidateConcept) => candidateConcept.id === targetConcept.id))
        .map((concept) => concept.label);
      const declaredSharedConcepts = targetConcepts
        .filter((targetConcept) => candidate.conceptLabels?.includes(targetConcept.label))
        .map((concept) => concept.label)
        .filter((label) => !sharedConcepts.includes(label));
      const sharedTokens = [...targetTokens].filter((token) => candidateTokens.has(token));
      const titleBoost = titleContainsSharedConcept(target.title, candidate.title, sharedConcepts) ? 4 : 0;
      const score = sharedConcepts.length * 9 + declaredSharedConcepts.length * 2 + Math.min(sharedTokens.length, 6) * 1.5 + titleBoost;

      return {
        ...candidate,
        score: Number(score.toFixed(1)),
        sharedConcepts: [...sharedConcepts, ...declaredSharedConcepts],
        sharedTokens: sharedTokens.slice(0, 8),
        excerpt: candidate.excerpt ?? extractRelevantExcerpt(candidateText, targetText)
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || String(left.title).localeCompare(String(right.title), "zh-Hant"))
    .slice(0, maximumMatches);
}

export function extractRelevantExcerpt(sourceText, targetText, maximumLength = 1700) {
  const normalisedSource = normaliseWhitespace(sourceText);
  if (normalisedSource.length <= maximumLength) {
    return normalisedSource;
  }

  const terms = [
    ...identifyConcepts(targetText).flatMap((concept) => concept.hits),
    ...[...extractTokens(targetText)].slice(0, 12)
  ].map((term) => term.toLocaleLowerCase("en"));
  const sections = normalisedSource.split(/(?<=[。.!?])\s+/u).filter(Boolean);
  const rankedSections = sections
    .map((section, index) => ({
      section,
      index,
      score: terms.reduce((total, term) => total + (section.toLocaleLowerCase("en").includes(term) ? 1 : 0), 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selectedSections = rankedSections.length > 0
    ? rankedSections.slice(0, 6).sort((left, right) => left.index - right.index).map((entry) => entry.section)
    : [normalisedSource.slice(0, maximumLength)];
  return selectedSections.join(" ").slice(0, maximumLength);
}

export function normaliseWhitespace(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function normaliseText(value) {
  return normaliseWhitespace(value).toLocaleLowerCase("en");
}

function extractTokens(value) {
  const ignoredTerms = new Set(["with", "from", "that", "this", "have", "were", "their", "into", "after", "among", "using", "study", "studies", "research", "results", "analysis", "assessment", "testing", "test", "performance", "standard", "including", "should", "sports", "sport", "exercise", "athlete", "athletes", "運動", "研究", "策略", "內容"]);
  return new Set(
    normaliseText(value)
      .match(/[a-z][a-z0-9-]{3,}/gu)
      ?.filter((token) => !ignoredTerms.has(token))
      ?? []
  );
}

function titleContainsSharedConcept(targetTitle, candidateTitle, sharedConceptLabels) {
  const targetTitleConcepts = new Set(identifyConcepts(targetTitle).map((concept) => concept.label));
  const candidateTitleConcepts = new Set(identifyConcepts(candidateTitle).map((concept) => concept.label));
  return sharedConceptLabels.some((label) => targetTitleConcepts.has(label) && candidateTitleConcepts.has(label));
}