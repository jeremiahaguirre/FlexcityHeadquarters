import { describe, expect, it } from 'vitest';
import { renderEmail } from '../../src/services/notifications/mailer.js';

const p = { service: 'Salle de fête', when: '28 nov. 2026, 10 h 00', reference: 'B-123', note: 'Bassin fermé ce jour-là.' };

describe('booking decision email', () => {
  it('a cancelled booking says it was cancelled, in the language it was booked in, with the note', () => {
    const fr = renderEmail('booking_decided', 'fr-CA', { ...p, confirmed: false, decision: 'CANCELLED' });
    expect(fr.subject).toBe('Réservation annulée : Salle de fête');
    expect(fr.text).toContain('nous avons dû annuler votre réservation');
    expect(fr.text).toContain('Bassin fermé ce jour-là.');
    const en = renderEmail('booking_decided', 'en-CA', { ...p, service: 'Party room', confirmed: false, decision: 'CANCELLED' });
    expect(en.subject).toBe('Booking cancelled: Party room');
  });

  it('confirmed and declined read as before, including rows queued before the decision was sent', () => {
    expect(renderEmail('booking_decided', 'fr-CA', { ...p, confirmed: true, decision: 'CONFIRMED' }).subject).toBe('Réservation confirmée : Salle de fête');
    expect(renderEmail('booking_decided', 'en-CA', { ...p, service: 'Party room', confirmed: false }).subject).toBe('Booking not available: Party room');
  });
});
