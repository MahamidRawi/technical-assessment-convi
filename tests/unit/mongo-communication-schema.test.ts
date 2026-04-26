import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoCommunicationSchema } from '@/types/mongo.types';

test('MongoCommunicationSchema accepts sparse participant fields from source data', () => {
  const parsed = MongoCommunicationSchema.parse({
    _id: 'comm-1',
    caseId: 'CASE-1',
    status: 'sent',
    from: {
      name: null,
      email: 'sender@example.com',
      phone: null,
      contactId: null,
    },
    to: [
      {
        name: null,
        email: 'recipient@example.com',
        phone: null,
        contactId: null,
      },
    ],
    cc: null,
  });

  assert.equal(parsed.from?.name, null);
  assert.equal(parsed.to?.[0]?.name, null);
  assert.equal(parsed.cc, null);
});
