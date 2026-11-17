import { describe, expect, it } from 'vitest';
import { vehicleBody } from './fleet';

describe('vehicle form', () => {
  it('sends blanks as none, so an edit can clear a plate, licence or yard', () => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ unit: ' P-12 ', description: 'Tandem plow', plate: '', cert: '', facility: '' })) f.set(k, v);
    expect(vehicleBody(f)).toEqual({ unit: 'P-12', description: 'Tandem plow', plate: null, certificationId: null, facilityId: null });
    f.set('plate', 'AB 123');
    f.set('cert', 'c1');
    expect(vehicleBody(f)).toMatchObject({ plate: 'AB 123', certificationId: 'c1' });
  });
});
