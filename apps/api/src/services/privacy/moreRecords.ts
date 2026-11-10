/** Records from the newer features, added to a person's records export. */
import type { Tx } from '../../lib/db.js';

export async function moreRecords(tx: Tx, userId: string) {
  const w = { where: { userId } };
  const [emergencyContacts] = await Promise.all([
    tx.emergencyContact.findMany({ ...w, select: { name: true, relationship: true, phone: true, altPhone: true, priority: true, updatedAt: true } }),
  ]);
  return { emergencyContacts };
}
