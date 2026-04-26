import type { Db } from 'mongodb';
import type { Session } from 'neo4j-driver';
import { MongoFileSchema, extractISODate, extractSourceId } from '../../types/mongo.types';
import { readCollection } from '../../db/mongo';
import { resolveFileCaseId } from './normalize';
import { createLogger } from '@/utils/logger';

const logger = createLogger('Ingest');

interface DocumentRow {
  sourceId: string;
  caseId: string;
  fileName: string;
  mimeType: string | null;
  documentType: string;
  documentCategory: string;
  documentDate: string | null;
  uploadedAt: string | null;
  processingStatus: string;
  hasOcr: boolean;
  pageCount: number | null;
  sourceFileId: string | null;
  isModified: boolean;
}

function docTypeName(value: string | null | undefined): string {
  const name = value?.trim();
  return name ? name : 'unclassified';
}

export async function writeDocuments(
  session: Session,
  db: Db,
  fetchLimit: number,
  caseIds: Set<string>
): Promise<void> {
  logger.log('\nWriting Document nodes + category/type/provenance edges');
  const mongoFiles = await readCollection(db, 'files', MongoFileSchema, {}, { limit: fetchLimit });
  const documentRows: DocumentRow[] = [];
  const categoryRows: Array<{ name: string }> = [];
  const typeRows: Array<{ name: string }> = [];
  const hasDocumentRows: Array<{ caseId: string; sourceId: string }> = [];
  const ofCategoryRows: Array<{ sourceId: string; categoryName: string }> = [];
  const ofTypeRows: Array<{ sourceId: string; typeName: string }> = [];
  const derivedRows: Array<{ sourceId: string; parentId: string }> = [];
  const seenCategories = new Set<string>();
  const seenTypes = new Set<string>();

  for (const file of mongoFiles) {
    const resolvedCaseId = resolveFileCaseId(file, caseIds);
    if (!resolvedCaseId) continue;
    const sourceId = extractSourceId(file._id);
    const categoryName = file.processedData?.document_category?.trim() || 'other';
    const typeName = docTypeName(file.processedData?.document_type ?? null);
    if (!seenCategories.has(categoryName)) {
      seenCategories.add(categoryName);
      categoryRows.push({ name: categoryName });
    }
    if (!seenTypes.has(typeName)) {
      seenTypes.add(typeName);
      typeRows.push({ name: typeName });
    }
    documentRows.push({
      sourceId,
      caseId: resolvedCaseId,
      fileName: file.fileName,
      mimeType: file.mimeType ?? null,
      documentType: typeName,
      documentCategory: categoryName,
      documentDate: file.processedData?.document_date ?? null,
      uploadedAt: extractISODate(file.uploadedAt),
      processingStatus: file.processingStatus ?? 'unknown',
      hasOcr: file.processedData?.has_ocr ?? false,
      pageCount: file.pageCount ?? null,
      sourceFileId: file.sourceFileId ? extractSourceId(file.sourceFileId) : null,
      isModified: file.isModified === true,
    });
    hasDocumentRows.push({ caseId: resolvedCaseId, sourceId });
    ofCategoryRows.push({ sourceId, categoryName });
    ofTypeRows.push({ sourceId, typeName });
    if (file.sourceFileId) {
      derivedRows.push({ sourceId, parentId: extractSourceId(file.sourceFileId) });
    }
  }

  await session.run(
    `UNWIND $rows AS row
     MERGE (d:Document {sourceId: row.sourceId})
     SET d.caseId = row.caseId,
         d.fileName = row.fileName,
         d.mimeType = row.mimeType,
         d.documentType = row.documentType,
         d.documentCategory = row.documentCategory,
         d.documentDate = row.documentDate,
         d.uploadedAt = row.uploadedAt,
         d.processingStatus = row.processingStatus,
         d.hasOcr = row.hasOcr,
         d.pageCount = row.pageCount,
         d.sourceFileId = row.sourceFileId,
         d.isModified = row.isModified`,
    { rows: documentRows }
  );
  await session.run(`UNWIND $rows AS row MERGE (:DocumentCategory {name: row.name})`, { rows: categoryRows });
  await session.run(`UNWIND $rows AS row MERGE (:DocumentType {name: row.name})`, { rows: typeRows });
  await session.run(
    `UNWIND $rows AS row
     MATCH (c:Case {caseId: row.caseId}), (d:Document {sourceId: row.sourceId})
     MERGE (c)-[:HAS_DOCUMENT]->(d)`,
    { rows: hasDocumentRows }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (d:Document {sourceId: row.sourceId}), (dc:DocumentCategory {name: row.categoryName})
     MERGE (d)-[:OF_CATEGORY]->(dc)`,
    { rows: ofCategoryRows }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (d:Document {sourceId: row.sourceId}), (dt:DocumentType {name: row.typeName})
     MERGE (d)-[:OF_TYPE]->(dt)`,
    { rows: ofTypeRows }
  );
  await session.run(
    `UNWIND $rows AS row
     MATCH (child:Document {sourceId: row.sourceId}), (parent:Document {sourceId: row.parentId})
     MERGE (child)-[:DERIVED_FROM]->(parent)`,
    { rows: derivedRows }
  );
  logger.log(`Wrote ${documentRows.length} Documents with ${derivedRows.length} provenance edges`);
}
