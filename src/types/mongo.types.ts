import { z } from 'zod';

const IdSchema = z.unknown();
const DateLikeSchema = z.unknown();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const MongoCaseSchema = z.object({
  _id: IdSchema,
  caseId: z.string(),
  caseName: z.string(),
  caseNumber: z.string().nullish(),
  caseType: z.string(),
  legalStage: z.string(),
  subStage: z.string().nullish(),
  phase: z.string(),
  status: z.string(),
  isSigned: z.boolean(),
  clientContactId: z.string().nullish(),
  createdAt: DateLikeSchema.nullish(),
  eventDate: DateLikeSchema.nullish(),
  signedAt: DateLikeSchema.nullish(),
  legalStageEnteredAt: DateLikeSchema.nullish(),
  updatedAt: DateLikeSchema.nullish(),
  aiGeneratedSummary: z.string().nullish(),
  injuries: z.object({
    initial: z.array(z.string()).optional(),
    current: z.array(z.string()).optional(),
  }).passthrough().nullish(),
  medicalInfo: z.object({
    injuredBodyParts: z.array(z.string()).nullish(),
  }).passthrough().nullish(),
}).passthrough();
export type MongoCase = z.infer<typeof MongoCaseSchema>;

const ExpertSchema = z.object({
  name: z.string(),
  specialty: z.string().nullish(),
}).passthrough();

export const FinancialProjectionSchema = z.object({
  caseId: z.string(),
  projection: z.object({
    checklist: z.object({
      completionRate: z.number().optional(),
      missingCritical: z.array(z.string()).optional(),
    }).optional(),
    timing: z.object({
      monthsSinceEvent: z.number().optional(),
      isOverdue: z.boolean().optional(),
    }).optional(),
    caseData: z.object({
      insuranceCompany: z.string().nullish(),
      mainInjury: z.string().nullish(),
      experts: z.object({
        ours: z.array(ExpertSchema).optional(),
        court: z.array(ExpertSchema).optional(),
      }).passthrough().nullish(),
    }).passthrough().nullish(),
  }).optional(),
}).passthrough();
export type FinancialProjection = z.infer<typeof FinancialProjectionSchema>;
export type MongoExpert = z.infer<typeof ExpertSchema>;

export const MongoContactSchema = z.object({
  _id: IdSchema,
  name: z.string(),
  contactType: z.string(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  caseIds: z.array(z.string()).optional(),
}).passthrough();
export type MongoContact = z.infer<typeof MongoContactSchema>;

export const MongoFileSchema = z.object({
  _id: IdSchema,
  caseId: z.string().nullish(),
  fileName: z.string(),
  mimeType: z.string().nullish(),
  uploadedAt: DateLikeSchema.nullish(),
  processingStatus: z.string().nullish(),
  pageCount: z.number().nullish(),
  sourceFileId: IdSchema.nullish(),
  isModified: z.boolean().optional(),
  versions: z
    .array(
      z.object({
        fileId: IdSchema.optional(),
        uploadedAt: DateLikeSchema.nullish(),
      }).passthrough()
    )
    .optional(),
  processedData: z.object({
    document_type: z.string().nullish(),
    document_category: z.string().nullish(),
    document_date: z.string().nullish(),
    has_ocr: z.boolean().optional(),
    aiName: z.string().nullish(),
    fileDescription: z.string().nullish(),
  }).nullish(),
  legacyMetadata: z.object({
    documentRefs: z.array(z.object({
      document_id: z.string().optional(),
    }).passthrough()).optional(),
  }).nullish(),
}).passthrough();
export type MongoFile = z.infer<typeof MongoFileSchema>;

export const MongoActivityLogSchema = z.object({
  _id: IdSchema,
  caseId: z.string(),
  category: z.string().nullish(),
  action: z.string(),
  summary: z.string().nullish(),
  timestamp: DateLikeSchema.nullish(),
  details: z.record(z.string(), z.unknown()).nullish(),
}).passthrough();
export type MongoActivityLog = z.infer<typeof MongoActivityLogSchema>;

export const MongoCommunicationSchema = z.object({
  _id: IdSchema,
  caseId: z.string(),
  type: z.string().nullish(),
  direction: z.string().nullish(),
  status: z.string().nullish(),
  sentAt: DateLikeSchema.nullish(),
  createdAt: DateLikeSchema.nullish(),
  subject: z.string().nullish(),
  bodyText: z.string().nullish(),
  summary: z.string().nullish(),
  ocrText: z.string().nullish(),
  from: z.object({
    name: z.string().nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
    contactId: z.string().nullish(),
  }).passthrough().nullish(),
  to: z.array(
    z.object({
      name: z.string().nullish(),
      email: z.string().nullish(),
      phone: z.string().nullish(),
      contactId: z.string().nullish(),
    }).passthrough()
  ).nullish(),
  cc: z.array(
    z.object({
      name: z.string().nullish(),
      email: z.string().nullish(),
      phone: z.string().nullish(),
      contactId: z.string().nullish(),
    }).passthrough()
  ).nullish(),
  metadata: z.object({
    transcript: z.string().nullish(),
    aiSummary: z.string().nullish(),
    sender: z.string().nullish(),
    from_address: z.string().nullish(),
  }).passthrough().nullish(),
}).passthrough();
export type MongoCommunication = z.infer<typeof MongoCommunicationSchema>;

export function extractSourceId(id: unknown): string {
  if (isRecord(id)) {
    if (typeof id.$oid === 'string') {
      return id.$oid;
    }
    if (typeof id.toString === 'function') {
      return String(id.toString());
    }
  }
  return String(id);
}

export function extractISODate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (isRecord(value) && '$date' in value) {
    const d = value.$date;
    if (typeof d === 'string') return d;
  }
  if (typeof value === 'string') return value;
  return null;
}
