export interface TurnToolPolicy {
  name:
    | 'graphEvidenceScenario'
    | 'medicalEvidenceCaseSearch'
    | 'caseProgressionToStage'
    | 'seededComparableFollowup';
  instructionSuffix: string;
  activeTools: string[];
  requiredToolSequence: string[];
}

const OCR_FACT_OR_VALUE_TERMS =
  /ביטוח\s*לאומי|מל["״]?ל|ועדה|נכות|נכוי|נכויות|זמני|זמנית|תקנה\s*15|תלוש|תלושי|שכר|מעסיק|דמי\s*פגיעה|תאונת\s*עבודה|תאונת\s*דרכים|work\s*accident|nii|disability|medical\s*committee|salary|income|regulation\s*15/i;

const SCENARIO_OR_DOCUMENT_TERMS =
  /אדם\s+בן\s+\d+|לקוח|client|תיק\s+של|השלבים\s+הבאים|שלבים\s+הבאים|מסמכים|מסמך|אמורים\s+להיות|חסר|missing|next\s*steps|case\s*value|שווי|כמה\s+שווה/i;

const GRAPH_ONLY_TERMS =
  /רק\s+על\s+סמך\s+שאילתות\s+מהגרף|רק\s+מהגרף|שאילתות\s+מהגרף|only\s+from\s+graph|graph\s*only/i;

const EXPLICIT_READINESS_TERMS =
  /historical\s+readiness|readiness\s+pattern|דפוס\s+מוכנות|קוהורט|cohort|targetStage|זמן\s+להגיע\s+לשלב|כמה\s+זמן\s+לשלב/i;

const CASE_PROGRESSION_TERMS =
  /מה\s+יכול\s+לקדם|לקדם\s+את\s+התיק|לקדם.*כתב\s+תביעה|לכתב\s+תביעה|להגשת\s+כתב\s+תביעה|להגיש\s+תביעה|מה\s+חסר.*(?:כתב\s+תביעה|הגשת\s+תביעה)|advance.*(?:claim|complaint|filing)|move.*(?:claim|complaint|filing)/i;

const SEEDED_COMPARABLE_TERMS =
  /(?:תביא|הבא|מצא|תראה|ראה|show|find).{0,40}תיק(?:ים|י)?.{0,80}(?:דומ|מאפיינים\s+דומים)|תיק(?:ים|י)?.{0,80}(?:הכי\s+הרבה\s+המאפיינים\s+הדומים|דומים\s+ביותר)|similar\s+cases|comparable\s+cases|most\s+similar/i;

const CASE_LIST_TERMS =
  /ראה\s+לי\s+תיקים|תראה\s+לי\s+תיקים|הראה\s+לי\s+תיקים|איזה\s+תיקים|אילו\s+תיקים|תיקים\s+שיש|show\s+cases|list\s+cases|which\s+cases/i;

const MEDICAL_CONCEPT_TERMS =
  /נוירולוג|עצב|עצבי|עצבים|רדיקול|נימול|רדימות|תחושה|חולשה|הקרנה|emg|עמוד\s+שדרה|שדרה|גב|צוואר|צואר|דיסק|חוליה|חוליות|מותני|צווארי|צוארי|neurolog|nerve|spine|back|neck|disc|radicul/i;

const GRAPH_EVIDENCE_SCENARIO_TOOLS = [
  'findCase',
  'searchDocumentEvidence',
  'getCaseDocumentFacts',
  'findComparableCasesByFacts',
  'getCaseValueContext',
  'searchCases',
  'getCaseDocuments',
  'getCaseEvidence',
] as const;

const REQUIRED_GRAPH_EVIDENCE_SEQUENCE = [
  'searchDocumentEvidence',
  'findComparableCasesByFacts',
  'getCaseValueContext',
] as const;

const MEDICAL_EVIDENCE_CASE_SEARCH_TOOLS = [
  'searchCasesByMedicalEvidence',
  'searchDocumentEvidence',
  'searchCases',
] as const;

const REQUIRED_MEDICAL_EVIDENCE_SEQUENCE = ['searchCasesByMedicalEvidence'] as const;

const CASE_PROGRESSION_TO_STAGE_TOOLS = [
  'findCase',
  'getCaseOverview',
  'getCaseEvidence',
  'getCaseDocuments',
  'getCaseDocumentFacts',
  'deriveReadinessPattern',
  'compareCaseToReadinessPattern',
  'searchDocumentEvidence',
] as const;

const REQUIRED_CASE_PROGRESSION_SEQUENCE = [
  'findCase',
  'getCaseOverview',
  'getCaseEvidence',
  'getCaseDocuments',
  'getCaseDocumentFacts',
  'compareCaseToReadinessPattern',
] as const;

const SEEDED_COMPARABLE_TOOLS = [
  'findCase',
  'getCaseOverview',
  'getCaseDocumentFacts',
  'findComparableCasesByFacts',
  'findSimilarCases',
  'findMostSimilarCasePairs',
  'searchDocumentEvidence',
] as const;

export function shouldUseGraphEvidenceScenarioPolicy(userText: string): boolean {
  const text = userText.trim();
  if (!text) return false;
  if (EXPLICIT_READINESS_TERMS.test(text)) return false;
  return (
    OCR_FACT_OR_VALUE_TERMS.test(text) &&
    (GRAPH_ONLY_TERMS.test(text) || SCENARIO_OR_DOCUMENT_TERMS.test(text))
  );
}

export function shouldUseMedicalEvidenceCaseSearchPolicy(userText: string): boolean {
  const text = userText.trim();
  if (!text) return false;
  if (EXPLICIT_READINESS_TERMS.test(text)) return false;
  return CASE_LIST_TERMS.test(text) && MEDICAL_CONCEPT_TERMS.test(text);
}

export function shouldUseCaseProgressionToStagePolicy(userText: string): boolean {
  const text = userText.trim();
  if (!text) return false;
  if (EXPLICIT_READINESS_TERMS.test(text)) return false;
  return CASE_PROGRESSION_TERMS.test(text);
}

export function shouldUseSeededComparableFollowupPolicy(userText: string): boolean {
  const text = userText.trim();
  if (!text) return false;
  if (EXPLICIT_READINESS_TERMS.test(text)) return false;
  return SEEDED_COMPARABLE_TERMS.test(text);
}

export function buildTurnToolPolicy(userText: string): TurnToolPolicy | null {
  if (shouldUseMedicalEvidenceCaseSearchPolicy(userText)) {
    return {
      name: 'medicalEvidenceCaseSearch',
      activeTools: [...MEDICAL_EVIDENCE_CASE_SEARCH_TOOLS],
      requiredToolSequence: [...REQUIRED_MEDICAL_EVIDENCE_SEQUENCE],
      instructionSuffix: `
Turn-specific routing override:
This user request asks to list cases by a broad medical concept. Use searchCasesByMedicalEvidence first. Do not answer from exact searchCases injuryName/bodyPart filters alone because graph injury labels are sparse and OCR evidence often carries the relevant medical wording.

For neurological/spine Hebrew queries, search broadly across nerve/neurological concepts (נוירולוגי, עצב, נימול, רדימות, תחושה, חולשה, הקרנה, EMG) and spine concepts (עמוד שדרה, שדרה, גב, צוואר/צואר, דיסק, חוליות, מותני/צווארי). In the answer, list case IDs and concise graph-backed reasons/snippets. If results are OCR-backed rather than structured Injury/BodyPart nodes, say so explicitly.
`.trim(),
    };
  }

  if (shouldUseCaseProgressionToStagePolicy(userText)) {
    return {
      name: 'caseProgressionToStage',
      activeTools: [...CASE_PROGRESSION_TO_STAGE_TOOLS],
      requiredToolSequence: [...REQUIRED_CASE_PROGRESSION_SEQUENCE],
      instructionSuffix: `
Turn-specific routing override:
This is a case-specific progression question ("what can advance this case to a filing/complaint stage and why"). Resolve the case first, then inspect the current case state and graph evidence before using historical readiness. Required evidence flow: findCase, getCaseOverview, getCaseEvidence, getCaseDocuments, getCaseDocumentFacts, then compareCaseToReadinessPattern with the target stage.

If the readiness cohort for the target stage is sparse or unavailable, do not stop there. Answer from graph-backed current-case evidence: missingCritical, document categories already present, OCR facts, required_document facts, and concrete gaps in the case. Clearly separate "learned historical pattern is sparse" from "current case facts that can still move the case forward". Answer in the user's language.
`.trim(),
    };
  }

  if (shouldUseSeededComparableFollowupPolicy(userText)) {
    return {
      name: 'seededComparableFollowup',
      activeTools: [...SEEDED_COMPARABLE_TOOLS],
      requiredToolSequence: [],
      instructionSuffix: `
Turn-specific routing override:
This is a request for the most similar/comparable cases. Use findComparableCasesByFacts, findSimilarCases, or findMostSimilarCasePairs; do not use portfolioAggregates as a proxy.

Decide the seed before any tool call:
- If a case was resolved earlier in this conversation and the user did not name a new case, use that resolved caseId as the seed.
- If the user provided a specific case identifier (caseId, case number, case name, or client name), resolve it with findCase first, then seed with the resolved caseId.
- If the user described a case-type CATEGORY (e.g. "תאונת דרכים" / car accident, "תאונת עבודה" / work accident, or any caseType vocabulary value) WITHOUT naming a specific case, do NOT call findCase. Go directly to findComparableCasesByFacts WITHOUT a seed AND pass the user's category term in the injury field (e.g. injury="תאונת דרכים", injury="תאונת עבודה"). The tool's normalizer auto-expands car-accident terms to BOTH severities (car_accident_minor + car_accident_serious) and work-accident terms to work_accident. Do NOT pick a specific severity in caseType yourself; let the normalizer expand.
- If the user asked for the most similar cases ACROSS THE WHOLE PORTFOLIO with NO seed AND NO category (e.g. "the 2 most similar cases I have", "מה ה־2 תיקים הכי דומים שיש לי", "what are the most similar cases overall"), call findMostSimilarCasePairs with limit:ceil(N/2) — for "2 most similar cases" use limit:1 (returns one pair = two cases). Do NOT pass a seed or invent a caseType. Never stuff caseId="me" or any placeholder.
- If you do call findCase and it returns zero candidates, do NOT stop. Treat the request as a no-seed category request and fall through to findComparableCasesByFacts with no seed and the category term in injury (per the category rule above).

Do not pass neutral default filters such as ageMin:0, ageMax:130, disabilityPercentMin:0, disabilityPercentMax:100, workAccidentFlag:false, or permanentDisability:false unless the user explicitly stated those constraints. For a seed case, prefer caseId + limit and let the tool derive overlap from the graph. In the final answer, explain the exact shared properties and evidence snippets returned by the tool, and surface the exact filters you sent to findComparableCasesByFacts when the user asks.
`.trim(),
    };
  }

  if (!shouldUseGraphEvidenceScenarioPolicy(userText)) return null;

  return {
    name: 'graphEvidenceScenario',
    activeTools: [...GRAPH_EVIDENCE_SCENARIO_TOOLS],
    requiredToolSequence: [...REQUIRED_GRAPH_EVIDENCE_SEQUENCE],
    instructionSuffix: `
Turn-specific routing override:
This user request is a graph-only OCR/fact/comparable scenario question, not a historical readiness-cohort question. Before answering, call the graph evidence tools in this order: searchDocumentEvidence, findComparableCasesByFacts, then getCaseValueContext. Do not call deriveReadinessPattern, compareCaseToReadinessPattern, estimateTimeToStage, benchmarkAgainstStage, findSameStageLeaders, or rankCasesByStageTransitionTime for this turn unless the user explicitly asks for historical readiness timing or a readiness cohort.

For the reviewer-style Hebrew scenario, infer only facts stated by the user: age around 30, traffic accident, work-accident context, National Insurance / ביטוח לאומי committee, and temporary disability. Prefer broad graph-backed filters over exact overfitting: workAccidentFlag true, car-accident/work-accident terms, and disability/NII/medical-committee/income/required-document facts. Use OCR snippets, EvidenceFact quotes, comparable-case facts, and valuation/missing-evidence context. Answer in Hebrew when the user writes Hebrew. If the graph does not support a precise disability or value estimate, say exactly what evidence is missing instead of filling it in.
`.trim(),
  };
}

export function nextRequiredTool(
  requiredToolSequence: readonly string[],
  calledTools: Iterable<string>
): string | null {
  const called = new Set(calledTools);
  return requiredToolSequence.find((toolName) => !called.has(toolName)) ?? null;
}
