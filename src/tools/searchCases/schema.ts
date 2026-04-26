import { z } from 'zod';

export const sortBySchema = z.enum([
  'completionRate',
  'monthsSinceEvent',
  'eventDate',
  'createdAt',
  'caseName',
  'missingCriticalCount',
  'documentCount',
]);

export const sortOrderSchema = z.enum(['asc', 'desc']);

export const inputSchema = z.object({
  caseType: z
    .string()
    .optional()
    .describe(
      "Exact match on c.caseType. OMIT unless the user asks about a specific type. Valid values: 'car_accident_serious', 'car_accident_minor', 'work_accident', 'student_accident', 'liability', 'medical_negligence', 'general_disability'."
    ),
  legalStage: z
    .string()
    .optional()
    .describe(
      "Exact match on c.legalStage. OMIT unless the user asks about a specific stage (e.g. 'case_building', 'settlement', 'file_claim')."
    ),
  phase: z
    .string()
    .optional()
    .describe(
      "Exact match on c.phase. OMIT unless the user asks about a specific phase. Valid values: 'lead', 'active', 'closing', 'closed', 'rejected'."
    ),
  status: z
    .string()
    .optional()
    .describe(
      "Exact match on c.status. OMIT unless the user explicitly asks about a specific status; do not default to 'open'. Valid values: 'open', 'pending_lawyer_review', 'intake_complete'."
    ),
  isSigned: z
    .boolean()
    .optional()
    .describe(
      'Filter by c.isSigned. OMIT entirely for no filter - passing `false` means "only unsigned cases" (rare). Pass true only when the user explicitly asks for signed cases.'
    ),
  isOverdue: z
    .boolean()
    .optional()
    .describe(
      'Filter by c.isOverdue. OMIT entirely for no filter - passing `false` means "only non-overdue cases" (rare). Pass true only when the user explicitly asks for overdue cases.'
    ),
  mainInjury: z.string().optional().describe('Substring match (case-insensitive, Hebrew-normalized) on c.mainInjury.'),
  clientName: z.string().optional().describe('Substring match (case-insensitive) on the related Contact name via HAS_CLIENT.'),
  injuryName: z
    .string()
    .optional()
    .describe(
      'Cases linked via HAS_INJURY to an Injury matching this term. Hebrew synonyms collapse automatically (e.g. "כאבי גב" matches "כאב גב").'
    ),
  bodyPart: z
    .string()
    .optional()
    .describe(
      'Cases linked via AFFECTS_BODY_PART to a BodyPart matching this term. Hebrew synonyms collapse automatically (e.g. "גב תחתון" matches "גב").'
    ),
  insurer: z
    .string()
    .optional()
    .describe(
      'Cases linked via AGAINST_INSURER to an InsuranceCompany matching this term. Hebrew synonyms collapse automatically (e.g. "הראל ביטוח" matches "הראל").'
    ),
  hasDocumentCategory: z.string().optional().describe("Cases that have at least one document of the given DocumentCategory name (e.g. 'medical_records')."),
  missingDocumentCategory: z.string().optional().describe('Cases whose missingCritical array contains the given category name.'),
  completionRateMin: z.number().min(0).max(1).optional().describe('Lower bound (inclusive) for c.completionRate, 0-1.'),
  completionRateMax: z.number().min(0).max(1).optional().describe('Upper bound (inclusive) for c.completionRate, 0-1.'),
  monthsSinceEventMin: z.number().optional().describe('Lower bound (inclusive) for c.monthsSinceEvent.'),
  monthsSinceEventMax: z.number().optional().describe('Upper bound (inclusive) for c.monthsSinceEvent.'),
  monthsToSoLMax: z
    .number()
    .optional()
    .describe(
      'Statute-of-limitations urgency filter: keep cases where 0 <= (SoL window - monthsSinceEvent) <= this value. Use 6 for "approaching SoL", 3 for "very urgent". Expired cases are excluded. OMIT entirely unless the user explicitly asks about SoL urgency - do not pass 0 as a default.'
    ),
  solExpired: z
    .boolean()
    .optional()
    .describe(
      'Pass true ONLY when the user explicitly asks for cases whose statute of limitations has already expired. Filters to cases where monthsSinceEvent >= SoL window. Omit otherwise.'
    ),
  eventDateFrom: z.string().optional().describe('Lower bound (inclusive) for c.eventDate as ISO string.'),
  eventDateTo: z.string().optional().describe('Upper bound (inclusive) for c.eventDate as ISO string.'),
  createdAtFrom: z.string().optional().describe('Lower bound (inclusive) for c.createdAt as ISO string.'),
  createdAtTo: z.string().optional().describe('Upper bound (inclusive) for c.createdAt as ISO string.'),
  signedAtFrom: z.string().optional().describe('Lower bound (inclusive) for c.signedAt as ISO string.'),
  signedAtTo: z.string().optional().describe('Upper bound (inclusive) for c.signedAt as ISO string.'),
  sortBy: sortBySchema.default('caseName').describe('Field to sort by.'),
  sortOrder: sortOrderSchema.default('asc').describe('Sort direction.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe(
      'Max rows to return. For single-result questions use 1-10; for portfolio aggregation (distributions, top-N, counts across all cases) use 100-200 so the agent can tabulate the full set.'
    ),
});

export type SearchCasesInput = z.infer<typeof inputSchema>;

export interface CaseSearchHit {
  caseId: string;
  caseName: string;
  caseNumber: string | null;
  caseType: string;
  legalStage: string;
  status: string | null;
  completionRate: number;
  monthsSinceEvent: number | null;
  monthsToSoL: number | null;
  isOverdue: boolean | null;
  eventDate: string | null;
  createdAt: string | null;
  signedAt: string | null;
  mainInjury: string | null;
  clientName: string | null;
  missingCriticalCount: number;
  documentCount: number;
  insurers: string[];
  injuries: string[];
}
