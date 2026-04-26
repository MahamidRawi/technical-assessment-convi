import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  MongoValidationError,
  type MongoCollectionLike,
  type MongoCursorLike,
  type ReadableMongoDb,
  readCollection,
} from '@/db/mongo';

class FakeCursor implements MongoCursorLike {
  constructor(private rows: unknown[]) {}

  limit(limit: number): MongoCursorLike {
    this.rows = this.rows.slice(0, limit);
    return this;
  }

  async toArray(): Promise<unknown[]> {
    return this.rows;
  }
}

class FakeCollection implements MongoCollectionLike {
  constructor(private rows: unknown[]) {}

  find(): MongoCursorLike {
    return new FakeCursor(this.rows);
  }
}

class FakeDb implements ReadableMongoDb {
  constructor(private rows: unknown[]) {}

  collection(): MongoCollectionLike {
    return new FakeCollection(this.rows);
  }
}

const rowSchema = z.object({
  _id: z.string(),
  name: z.string(),
});

test('readCollection fails invalid Mongo rows by default', async () => {
  const db = new FakeDb([{ _id: 'valid-1', name: 'Dana' }, { _id: 'bad-1' }]);

  await assert.rejects(
    () => readCollection(db, 'cases', rowSchema),
    (error) => {
      assert.ok(error instanceof MongoValidationError);
      assert.equal(error.collectionName, 'cases');
      assert.equal(error.rejectedRows[0]?.id, 'bad-1');
      assert.match(error.rejectedRows[0]?.errors[0] ?? '', /name/);
      return true;
    }
  );
});

test('readCollection can explicitly skip invalid Mongo rows', async () => {
  const db = new FakeDb([{ _id: 'valid-1', name: 'Dana' }, { _id: 'bad-1' }]);

  const rows = await readCollection(db, 'cases', rowSchema, {}, { allowInvalid: true });

  assert.deepEqual(rows, [{ _id: 'valid-1', name: 'Dana' }]);
});
