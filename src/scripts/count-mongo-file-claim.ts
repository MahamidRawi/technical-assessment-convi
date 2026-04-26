import 'dotenv/config';
import { connectMongo, closeMongo, getDb } from '@/db/mongo';

const TARGET_STAGE = 'file_claim';
const DB_NAME = 'convi-assessment';

async function main(): Promise<void> {
  await connectMongo();
  const db = getDb(DB_NAME);
  const cases = db.collection('cases');
  const activityLog = db.collection('case_activity_log');

  const totalCases = await cases.countDocuments({});

  // 1. Currently in file_claim
  const currentInStage = await cases
    .find({ legalStage: TARGET_STAGE }, { projection: { _id: 1, caseName: 1, caseNumber: 1, legalStageEnteredAt: 1, eventDate: 1 } })
    .toArray();

  // 2. Ever reached file_claim via parseable activity-log transitions
  const reachedViaActivity = await activityLog
    .find({ action: 'stage_changed', 'details.toStage': TARGET_STAGE })
    .toArray();
  const caseIdsFromActivity = new Set(reachedViaActivity.map((a) => String(a.caseId)));

  // 3. All distinct cases that reached file_claim (union of current + activity-log)
  const everReached = new Set<string>();
  for (const c of currentInStage) everReached.add(String(c._id));
  for (const id of caseIdsFromActivity) everReached.add(id);

  console.log(`MongoDB: ${DB_NAME}.cases`);
  console.log(`Total cases in collection:                    ${totalCases}`);
  console.log(`Currently with legalStage = "${TARGET_STAGE}":     ${currentInStage.length}`);
  console.log(`Ever reached "${TARGET_STAGE}" via activity log:    ${caseIdsFromActivity.size}`);
  console.log(`Distinct cases that ever touched the stage:   ${everReached.size}`);

  console.log(`\n--- Cases currently in ${TARGET_STAGE} ---`);
  for (const c of currentInStage) {
    console.log(
      `  _id=${String(c._id)} | name=${c.caseName ?? '?'} | caseNumber=${c.caseNumber ?? '?'} | enteredAt=${c.legalStageEnteredAt ?? '?'} | eventDate=${c.eventDate ?? '?'}`
    );
  }

  console.log(`\n--- Activity-log transitions to ${TARGET_STAGE} ---`);
  for (const a of reachedViaActivity) {
    console.log(
      `  caseId=${String(a.caseId)} | from=${a.details?.fromStage ?? '?'} | at=${a.createdAt ?? a.timestamp ?? '?'}`
    );
  }
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
