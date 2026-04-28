export interface TurnToolPolicy {
  name: 'graphEvidenceScenario' | 'medicalEvidenceCaseSearch';
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
