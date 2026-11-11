import { describe, expect, it } from 'vitest';
import { isPlaceholderContact, realContact } from './contact';

describe('placeholder contacts', () => {
  it('treats empty and example-domain addresses as placeholders', () => {
    for (const v of ['', '  ', null, undefined, 'billing@flexcityhq.example', 'mailto:support@flexcityhq.example', 'security@example.com', 'a@mail.example.org', 'SALES@FLEXCITYHQ.EXAMPLE']) expect(isPlaceholderContact(v)).toBe(true);
  });
  it('keeps real addresses', () => {
    for (const v of ['billing@flexcityhq.ca', 'help@examples.ca', 'ops@myexample.com']) expect(isPlaceholderContact(v)).toBe(false);
    expect(realContact(' billing@flexcityhq.ca ')).toBe('billing@flexcityhq.ca');
    expect(realContact('billing@flexcityhq.example')).toBeNull();
  });
});
