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

interface ArchivedParentRow {
  sourceId: string;
  caseId: string;
  fileName: string;
  pageCount: number | null;
  fileSize: number | null;
  archivedAt: string | null;
  archivedBy: string | null;
  gcsPath: string;
}

function docTypeName(value: string | null | undefined): string {
  const name = value?.trim();
  return name ? name : 'unclassified';
}

function archivedSourceIdFor(gcsPath: string): string {
  // Prefix avoids any chance of colliding with live Mongo file _ids.
  return `archived:${gcsPath}`;
}

function fileNameFromGcsPath(gcsPath: string): string {
  const idx = gcsPath.lastIndexOf('/');
  return idx >= 0 ? gcsPath.slice(idx + 1) : gcsPath;
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
  const archivedParentRows: ArchivedParentRow[] = [];
  const seenCategories = new Set<string>();
  const seenTypes = new Set<string>();
  const seenArchivedIds = new Set<string>();

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
    // Detect archived prior versions. Two distinct provenance paths exist in
    // source data:
    //   1. file.sourceFileId — points to another live Mongo file _id (cross-doc derivation)
    //   2. file.versions[].gcsPath — archived prior content for the same logical doc
    // Both surface as DERIVED_FROM edges so retrieval can answer "what was this
    // document before?" via a single traversal pattern.
    const hasArchivedVersions =
      Array.isArray(file.versions) && file.versions.some((v) => typeof v?.gcsPath === 'string' && v.gcsPath.length > 0);
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
      isModified: file.isModified === true || hasArchivedVersions,
    });
    hasDocumentRows.push({ caseId: resolvedCaseId, sourceId });
    ofCategoryRows.push({ sourceId, categoryName });
    ofTypeRows.push({ sourceId, typeName });
    if (file.sourceFileId) {
      derivedRows.push({ sourceId, parentId: extractSourceId(file.sourceFileId) });
    }
    if (Array.isArray(file.versions)) {
      for (const v of file.versions) {
        const gcsPath = typeof v?.gcsPath === 'string' ? v.gcsPath : null;
        if (!gcsPath) continue;
        const archivedSourceId = archivedSourceIdFor(gcsPath);
        if (!seenArchivedIds.has(archivedSourceId)) {
          seenArchivedIds.add(archivedSourceId);
          archivedParentRows.push({
            sourceId: archivedSourceId,
            caseId: resolvedCaseId,
            fileName: fileNameFromGcsPath(gcsPath),
            pageCount: typeof v.pageCount === 'number' ? v.pageCount : null,
            fileSize: typeof v.fileSize === 'number' ? v.fileSize : null,
            archivedAt: extractISODate(v.archivedAt ?? null),
            archivedBy: typeof v.archivedBy === 'string' ? v.archivedBy : null,
            gcsPath,
          });
        }
        derivedRows.push({ sourceId, parentId: archivedSourceId });
      }
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
  // Archived prior-version Documents. Created with archived=true so retrieval
  // queries that want only live docs can filter `WHERE NOT coalesce(d.archived, false)`.
  if (archivedParentRows.length > 0) {
    await session.run(
      `UNWIND $rows AS row
       MERGE (d:Document {sourceId: row.sourceId})
       SET d.caseId = row.caseId,
           d.fileName = row.fileName,
           d.pageCount = row.pageCount,
           d.fileSize = row.fileSize,
           d.archivedAt = row.archivedAt,
           d.archivedBy = row.archivedBy,
           d.gcsPath = row.gcsPath,
           d.archived = true,
           d.processingStatus = coalesce(d.processingStatus, 'archived')`,
      { rows: archivedParentRows }
    );
    // Attach archived parents to their case so case-scoped traversals find them.
    await session.run(
      `UNWIND $rows AS row
       MATCH (c:Case {caseId: row.caseId}), (d:Document {sourceId: row.sourceId})
       MERGE (c)-[:HAS_DOCUMENT]->(d)`,
      { rows: archivedParentRows }
    );
  }
  await session.run(
    `UNWIND $rows AS row
     MATCH (child:Document {sourceId: row.sourceId}), (parent:Document {sourceId: row.parentId})
     MERGE (child)-[:DERIVED_FROM]->(parent)`,
    { rows: derivedRows }
  );
  logger.log(
    `Wrote ${documentRows.length} Documents with ${derivedRows.length} provenance edges` +
      ` (${archivedParentRows.length} archived prior versions)`
  );
}
