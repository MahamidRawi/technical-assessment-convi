export type TurnIntent =
  | 'meta'
  | 'portfolio_graph'
  | 'portfolio_insight'
  | 'case_lookup'
  | 'case_communications'
  | 'seed_similarity'
  | 'global_similarity'
  | 'readiness'
  | 'stage_progression'
  | 'qualitative_extreme'
  | 'ambiguous';

export type RequiredCaveat = 'proxy' | 'sparse_data' | 'truncated' | 'ambiguous_case';

export interface ForbiddenArg {
  tool: string;
  arg: string;
}

export interface ToolPlan {
  intent: TurnIntent;
  requiredTools: string[];
  forbiddenArgs?: ForbiddenArg[];
  requiredCaveats?: RequiredCaveat[];
  allowCommunicationDirection?: boolean;
}

export const CASE_TYPE_VALUES = [
  'car_accident_serious',
  'car_accident_minor',
  'work_accident',
  'student_accident',
  'liability',
  'medical_negligence',
  'general_disability',
] as const;

export type CaseTypeValue = (typeof CASE_TYPE_VALUES)[number];

export function isKnownCaseType(value: string): value is CaseTypeValue {
  return CASE_TYPE_VALUES.includes(value.trim() as CaseTypeValue);
}

function includesAny(text: string, patterns: readonly (string | RegExp)[]): boolean {
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)
  );
}

function hasCaseReference(text: string): boolean {
  return (
    /\b[a-f0-9]{24}\b/i.test(text) ||
    /\(\d{4,}\)/.test(text) ||
    includesAny(text, ['case ', 'תיק ', 'התיק ', 'caseId'])
  );
}

function hasDirection(text: string): boolean {
  return includesAny(text, [
    'incoming',
    'outgoing',
    'received',
    'sent',
    'נכנס',
    'נכנסת',
    'נכנסות',
    'יוצא',
    'יוצאת',
    'יוצאות',
    'התקבל',
    'נשלח',
  ]);
}

export function planTurn(userPrompt: string): ToolPlan {
  const text = userPrompt.trim().toLowerCase();
  const allowCommunicationDirection = hasDirection(text);
  const noDirectionFilter: ForbiddenArg[] = allowCommunicationDirection
    ? []
    : [{ tool: 'getCaseCommunications', arg: 'direction' }];

  if (!text) {
    return { intent: 'ambiguous', requiredTools: [] };
  }

  if (
    includesAny(text, [
      'מה הפרומפט',
      'הפרומפט שלך',
      'prompt',
      'system prompt',
      'instructions',
    ])
  ) {
    return { intent: 'meta', requiredTools: [] };
  }

  if (
    includesAny(text, [
      'התכתב',
      'תקשורת',
      'communications',
      'messages',
      'emails',
      'מייל',
      'הודעות',
    ])
  ) {
    return {
      intent: 'case_communications',
      requiredTools: ['findCase', 'getCaseCommunications'],
      forbiddenArgs: noDirectionFilter,
      requiredCaveats: ['ambiguous_case'],
      allowCommunicationDirection,
    };
  }

  if (
    includesAny(text, [
      'הכי דומים',
      'הכי הרבה המאפיינים הדומים',
      'most similar',
      'most alike',
      'similar pair',
      /2\s+.*similar/,
      /שני\s+.*דומים/,
    ])
  ) {
    if (hasCaseReference(text) && includesAny(text, ['similar to', 'דומים ל', 'דומה ל'])) {
      return { intent: 'seed_similarity', requiredTools: ['findCase', 'findSimilarCases'] };
    }
    return { intent: 'global_similarity', requiredTools: ['rankSimilarCasePairs'] };
  }

  if (includesAny(text, ['similar to', 'דומים ל', 'דומה ל', 'cases like', 'תיקים כמו'])) {
    return { intent: 'seed_similarity', requiredTools: ['findCase', 'findSimilarCases'] };
  }

  if (
    includesAny(text, [
      'מוכן',
      'מוכנות',
      'מה יכול לקדם',
      'יקדם',
      'ready',
      'readiness',
      'what will move',
      'כמה זמן',
      'when will',
    ])
  ) {
    return {
      intent: 'readiness',
      requiredTools: ['findCase', 'deriveReadinessPattern', 'compareCaseToReadinessPattern'],
      requiredCaveats: ['sparse_data'],
    };
  }

  if (
    includesAny(text, [
      'מה השלב הבא',
      'השלב הבא',
      'לאן',
      'יתקדם',
      'להתקדם',
      'next stage',
      'progress',
      'stage progression',
    ])
  ) {
    return {
      intent: 'stage_progression',
      requiredTools: ['findCase', 'getStageTimeline', 'getObservedStageTransitions'],
      requiredCaveats: ['sparse_data'],
    };
  }

  if (
    includesAny(text, [
      'הכי משמעותית',
      'משמעותית',
      'הכי קשה',
      'הכי מורכב',
      'most significant',
      'most serious',
      'worst',
      'hardest',
      'most complex',
    ])
  ) {
    return {
      intent: 'qualitative_extreme',
      requiredTools: ['searchCases'],
      requiredCaveats: ['proxy'],
    };
  }

  if (
    includesAny(text, [
      'גרף',
      'graph',
      'dashboard',
      'breakdown',
      'התפלגות',
      'פילוח',
      'הכל יחד',
      'הכי רובוסטי',
    ])
  ) {
    return {
      intent: 'portfolio_graph',
      requiredTools: ['portfolioAggregates'],
      requiredCaveats: ['truncated'],
    };
  }

  if (
    includesAny(text, [
      'תובנה',
      'insight',
      'interesting',
      'מעניין',
      'רפואית',
      'medical',
    ])
  ) {
    return {
      intent: 'portfolio_insight',
      requiredTools: ['portfolioAggregates'],
      requiredCaveats: ['truncated'],
    };
  }

  if (hasCaseReference(text)) {
    return { intent: 'case_lookup', requiredTools: ['findCase'] };
  }

  return { intent: 'ambiguous', requiredTools: [] };
}

export function routeInstruction(plan: ToolPlan): string {
  const required = plan.requiredTools.length ? plan.requiredTools.join(', ') : 'none';
  const forbidden =
    plan.forbiddenArgs && plan.forbiddenArgs.length > 0
      ? plan.forbiddenArgs.map((item) => `${item.tool}.${item.arg}`).join(', ')
      : 'none';
  const caveats = plan.requiredCaveats?.join(', ') ?? 'none';

  return `
Routing constraint for this turn:
- intent: ${plan.intent}
- required tools: ${required}
- forbidden args: ${forbidden}
- required caveats when applicable: ${caveats}

Follow this route unless the user explicitly changes intent. If required graph data is sparse,
empty, truncated, ambiguous, or proxy-based, state that clearly and do not fill gaps with
generic legal or medical advice. Build the final answer from the evidence ledger implied by
tool outputs: direct facts may be stated plainly, proxies and inferences must be labeled,
and unsupported claims must be omitted.
`.trim();
}
