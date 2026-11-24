import { describe, expect, it } from 'vitest';
import { serviceBody } from './programs';

describe('bookable service form', () => {
  it('maps to the API: blanks clear, prices in cents, times in minutes, Bookable online as active', () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ facility: 'f1', name: 'Party room', nameFr: '', description: '', descriptionFr: 'Deux heures', duration: '120', price: '175,00', capacity: '2', party: '', open: '10:00', close: '18:30', lead: '3' })) f.set(k, v);
    expect(serviceBody(f, [6, 0])).toEqual({ facilityId: 'f1', name: 'Party room', nameFr: null, description: null, descriptionFr: 'Deux heures', durationMinutes: 120, priceCents: 17500, capacity: 2, maxPartySize: null, daysOfWeek: [6, 0], openMinute: 600, closeMinute: 1110, leadDays: 3, active: false });
    f.set('active', 'on');
    expect(serviceBody(f, [6]).active).toBe(true);
  });
});
