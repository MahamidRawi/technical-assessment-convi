// Single source of truth for the enum values documented in the assessment
// spec. Used in three places:
//   1. Zod schemas in src/types/mongo.types.ts (ingest-time validation).
//   2. The MCP safety layer's value-enum check (catches Cypher literals like
//      c.caseType = 'רכב' before the query runs).
//   3. The agent system prompt (so the LLM learns the valid English keys).
//
// When the data evolves, edit this file. Both ingest validation and Cypher
// validation pick up the change automatically.

import { z } from 'zod';

// ---- caseType --------------------------------------------------------
export const CASE_TYPES = [
  'car_accident_minor',
  'car_accident_serious',
  'work_accident',
  'liability',
  'medical_negligence',
  'student_accident',
  'general_disability',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];
export const CaseTypeSchema = z.enum(CASE_TYPES);

// ---- phase -----------------------------------------------------------
export const CASE_PHASES = ['lead', 'active', 'closing', 'closed', 'rejected'] as const;
export type CasePhase = (typeof CASE_PHASES)[number];
export const CasePhaseSchema = z.enum(CASE_PHASES);

// ---- legalStage (English snake_case keys observed in the live graph) -
// The spec calls this "current stage in the legal pipeline" without
// enumerating values. We pin the observed set so safety + prompt can
// reference it.
export const LEGAL_STAGES = [
  'reception',
  'case_building',
  'file_claim',
  'statement_of_claim',
  'statement_of_defense',
  'defense_statement',
  'recognition_claim',
  'opinion_review',
  'court_expert',
  'insurance_expert',
  'medical_committees',
  'disability_determination',
  'regulation_15',
  'negotiation_post_filing',
  'settlement',
  'appeal',
  'case_closed',
] as const;
export type LegalStage = (typeof LEGAL_STAGES)[number];
export const LegalStageSchema = z.enum(LEGAL_STAGES);

// ---- contactType -----------------------------------------------------
export const CONTACT_TYPES = [
  'client',
  'owner',
  'lawyer',
  'insurance_company',
  'doctor',
  'hospital',
  'employer',
  'witness',
  'opponent',
  'family',
] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];
export const ContactTypeSchema = z.enum(CONTACT_TYPES);

// ---- communication.type / direction ----------------------------------
export const COMMUNICATION_TYPES = [
  'email',
  'phone',
  'whatsapp',
  'internal_note',
  'sms',
  'meeting',
  'document_email',
  'voice_message',
] as const;
export type CommunicationType = (typeof COMMUNICATION_TYPES)[number];

export const COMMUNICATION_DIRECTIONS = ['inbound', 'outbound', 'incoming', 'outgoing'] as const;
export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];

// ---- file.processingStatus ------------------------------------------
export const FILE_PROCESSING_STATUSES = [
  'pending',
  'processing',
  'completed',
  'reprocessing',
  'failed',
] as const;
export type FileProcessingStatus = (typeof FILE_PROCESSING_STATUSES)[number];

// ---- summaryApprovalStatus ------------------------------------------
export const SUMMARY_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SummaryApprovalStatus = (typeof SUMMARY_APPROVAL_STATUSES)[number];

// ---- activity log category / action ---------------------------------
export const ACTIVITY_CATEGORIES = [
  'note',
  'status_change',
  'communication',
  'document',
  'signing',
  'pipeline',
  'contact',
  'agent_action',
  'system',
  'instruction',
  'reminder',
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

// ---- Case.status (observed in live graph; not in the spec text) -----
// Pinned here so safety can catch c.status='signed' (the agent's
// fabrication) — 'signed' is not a status, isSigned is the boolean.
export const CASE_STATUSES = ['open', 'pending_lawyer_review', 'intake_complete'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

// ---- Case.slaStatus (from financial projection caseStage) -----------
export const SLA_STATUSES = ['overdue', 'on_track', 'at_risk'] as const;
export type SlaStatus = (typeof SLA_STATUSES)[number];

// ---- vehicleInfo.role -----------------------------------------------
export const VEHICLE_ROLES = ['driver', 'passenger', 'pedestrian'] as const;
export type VehicleRole = (typeof VEHICLE_ROLES)[number];

// ---- Aggregated map for the safety layer ----------------------------
// Keyed by "<Label>.<property>" — matches how the safety layer extracts
// `var.prop = 'literal'` patterns. Keep keys in lowercase-prop form
// (caseType, status, etc.) so the matcher is straightforward.
export const VALUE_ENUMS: Record<string, readonly string[]> = {
  'Case.caseType': CASE_TYPES,
  'Case.phase': CASE_PHASES,
  'Case.legalStage': LEGAL_STAGES,
  'Case.status': CASE_STATUSES,
  'Case.slaStatus': SLA_STATUSES,
  'Case.summaryApprovalStatus': SUMMARY_APPROVAL_STATUSES,
  'Contact.contactType': CONTACT_TYPES,
  'Communication.type': COMMUNICATION_TYPES,
  'Communication.direction': COMMUNICATION_DIRECTIONS,
  'Document.processingStatus': FILE_PROCESSING_STATUSES,
  'Stage.name': LEGAL_STAGES,
  'ActivityEvent.category': ACTIVITY_CATEGORIES,
};

// Property-only fallback map: for properties whose value enum is the
// same regardless of which label they're attached to. Used when the
// safety layer can't determine the variable's label. `status` is included
// because the only "status" the spec documents as an enum is Case.status,
// and the agent's typical mistake (status='signed') needs to be caught.
export const VALUE_ENUMS_BY_PROPERTY: Record<string, readonly string[]> = {
  caseType: CASE_TYPES,
  phase: CASE_PHASES,
  legalStage: LEGAL_STAGES,
  slaStatus: SLA_STATUSES,
  status: CASE_STATUSES,
  contactType: CONTACT_TYPES,
};
