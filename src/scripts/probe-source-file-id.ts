import 'dotenv/config';
import { connectMongo, closeMongo, getDb } from '@/db/mongo';

async function main(): Promise<void> {
  await connectMongo();
  const db = getDb('convi-assessment');
  const files = db.collection('files');

  const total = await files.countDocuments({});
  const withSourceFileId = await files.countDocuments({ sourceFileId: { $exists: true, $nin: [null, ''] } });
  const isModifiedTrue = await files.countDocuments({ isModified: true });
  const withVersionsArray = await files.countDocuments({ 'versions.0': { $exists: true } });

  console.log(`files total:              ${total}`);
  console.log(`with sourceFileId set:    ${withSourceFileId}`);
  console.log(`with isModified === true: ${isModifiedTrue}`);
  console.log(`with versions[0] present: ${withVersionsArray}`);

  // Show one example with sourceFileId, if any
  const sample = await files.findOne({ sourceFileId: { $exists: true, $nin: [null, ''] } });
  if (sample) {
    console.log('\nSample file with sourceFileId:');
    console.log(JSON.stringify({ _id: sample._id, fileName: sample.fileName, sourceFileId: sample.sourceFileId, isModified: sample.isModified, versionsLen: sample.versions?.length }, null, 2));
  } else {
    console.log('\nNo file in collection has sourceFileId set.');
  }

  // Show one with versions array
  const versioned = await files.findOne({ 'versions.0': { $exists: true } });
  if (versioned) {
    console.log('\nSample file with versions[]:');
    console.log(JSON.stringify({ _id: versioned._id, fileName: versioned.fileName, isModified: versioned.isModified, versions: versioned.versions }, null, 2));
  }
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
