import { normalizeContactName } from './normalize';

export interface RawContact {
  sourceId: string;
  name: string;
  contactType: string;
  phone: string | null;
  email: string | null;
  caseIds: string[];
}

export interface DedupedContact {
  dedupKey: string;
  name: string;
  normalizedName: string;
  contactType: string;
  phone: string | null;
  email: string | null;
  sourceIds: string[];
  caseIds: string[];
}

function primaryContactPoint(c: Pick<RawContact, 'phone' | 'email'>): string {
  const email = c.email?.trim().toLowerCase();
  if (email) return `e:${email}`;
  const phone = c.phone?.replace(/\D/g, '');
  if (phone) return `p:${phone}`;
  return '';
}

export function buildContactDedupKey(
  contact: Pick<RawContact, 'sourceId' | 'name' | 'contactType' | 'phone' | 'email'>
): string {
  const contactPoint = primaryContactPoint(contact);
  if (!contactPoint) return `uniq:${contact.sourceId}`;
  const normalizedName = normalizeContactName(contact.name);
  return `${normalizedName}|${contact.contactType}|${contactPoint}`;
}

export function dedupeContacts(contacts: RawContact[]): DedupedContact[] {
  const merged = new Map<string, DedupedContact>();

  for (const c of contacts) {
    const normalizedName = normalizeContactName(c.name);
    const key = buildContactDedupKey(c);

    const existing = merged.get(key);
    if (existing) {
      existing.sourceIds.push(c.sourceId);
      for (const caseId of c.caseIds) {
        if (!existing.caseIds.includes(caseId)) existing.caseIds.push(caseId);
      }
      existing.phone ??= c.phone;
      existing.email ??= c.email;
    } else {
      merged.set(key, {
        dedupKey: key,
        name: c.name,
        normalizedName,
        contactType: c.contactType,
        phone: c.phone,
        email: c.email,
        sourceIds: [c.sourceId],
        caseIds: [...c.caseIds],
      });
    }
  }

  return Array.from(merged.values());
}
