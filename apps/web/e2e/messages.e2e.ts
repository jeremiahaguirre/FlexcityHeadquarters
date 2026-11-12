import { expect, test } from '@playwright/test';
import { inFrench, open, sideways, signInAs, tabBar, watchErrors } from './helpers';

/** Team messaging on a phone: the list, one conversation at a time, sending, and who you can write to. */
test.describe('messages on a phone', () => {
  test('open a conversation, send a message, and go back to the list', async ({ page }) => {
    const errors = watchErrors(page);
    await signInAs(page, 'STAFF');
    await open(page, '/messages');
    const list = page.getByRole('region', { name: 'Conversations' });
    await expect(list.getByRole('button', { name: /Junior guard mentoring/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /Aquatics/ })).toBeVisible();
    // The safety note: not for emergencies, and the employer can read them in an investigation.
    await expect(list.getByText(/Messages aren’t for emergencies\. If you’re in danger, call 911\./)).toBeVisible();
    await expect(list.getByText(/These are workplace messages\./)).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    await list.getByRole('button', { name: /Sam Okafor/ }).tap();
    await expect(page).toHaveURL(/\/messages\/?\?c=/);
    // One at a time on a phone: the list makes way for the conversation.
    await expect(list).toBeHidden();
    const thread = page.getByRole('region', { name: 'Conversation' });
    await expect(thread.getByRole('heading', { name: 'Sam Okafor' })).toBeVisible();
    const sent = thread.locator('ol > li');
    const before = await sent.count();
    const composer = thread.getByRole('textbox', { name: 'Write a message' });
    await expect(thread.getByRole('button', { name: 'Send' })).toBeDisabled();
    await composer.tap();
    await expect(tabBar(page)).toBeHidden();
    await composer.fill('Running five minutes late, see you at the pool.');
    await thread.getByRole('button', { name: 'Send' }).tap();
    // The demo keeps what you send for this visit.
    await expect(thread.getByText('Running five minutes late, see you at the pool.')).toBeVisible();
    await expect(sent).toHaveCount(before + 1);
    await expect(composer).toHaveValue('');
    expect(await sideways(page)).toBeLessThanOrEqual(0);

    await thread.getByRole('button', { name: 'Back to conversations' }).tap();
    await expect(list).toBeVisible();
    await list.getByRole('button', { name: /Sam Okafor/ }).tap();
    await expect(thread.getByText('Running five minutes late, see you at the pool.')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the message box stays above the keyboard and inside the screen', async ({ page }) => {
    await signInAs(page, 'STAFF');
    await open(page, '/messages');
    await page.getByRole('region', { name: 'Conversations' }).getByRole('button', { name: /Junior guard mentoring/ }).tap();
    const thread = page.getByRole('region', { name: 'Conversation' });
    const composer = thread.getByRole('textbox', { name: 'Write a message' });
    const send = thread.getByRole('button', { name: 'Send' });
    await composer.tap();
    await composer.fill('A long message that wraps over a few lines on a phone screen, to check nothing gets pushed sideways.');
    // About what's left above an iPhone keyboard.
    await page.setViewportSize({ width: 390, height: 360 });
    await composer.focus();
    await expect
      .poll(async () => {
        const [box, button] = [await composer.boundingBox(), await send.boundingBox()];
        const vv = await page.evaluate(() => ({ h: window.visualViewport?.height ?? window.innerHeight, w: window.innerWidth }));
        return !!box && !!button && box.y >= 0 && box.y + Math.min(box.height, 44) <= vv.h && button.x + button.width <= vv.w;
      })
      .toBe(true);
    const sendBox = (await send.boundingBox())!;
    expect(sendBox.height).toBeGreaterThanOrEqual(44);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('“A person” lists only people you can write to one to one, with a calm line for the rest', async ({ page }) => {
    await signInAs(page, 'HR_ADMIN');
    await open(page, '/messages');
    await page.getByRole('button', { name: 'New', exact: true }).tap();
    const sheet = page.locator('dialog[open]');
    await expect(sheet.getByRole('radio', { name: 'A person' })).toBeChecked();
    await expect(sheet.getByRole('button', { name: 'Sam Okafor' })).toBeVisible();
    // Morgan Lee is a minor in the sample city: no one-to-one conversations with adults.
    await expect(sheet.getByRole('button', { name: 'Morgan Lee' })).toHaveCount(0);
    await expect(sheet.getByText(/^Don’t see someone\? Some one-to-one conversations aren’t available/)).toBeVisible();
    await sheet.getByRole('searchbox', { name: 'Find someone' }).fill('jor');
    await expect(sheet.getByRole('button', { name: 'Jordan Singh' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sam Okafor' })).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('supervisor: the picker, with a new hire with no birth date only in groups (rule of two)', async ({ page }) => {
    await signInAs(page, 'AQUATIC_SUPERVISOR');
    await open(page, '/messages');
    await page.getByRole('button', { name: 'New', exact: true }).tap();
    const sheet = page.locator('dialog[open]');
    await expect(sheet.getByRole('radio', { name: 'A person' })).toBeChecked();
    await expect(sheet.getByRole('button', { name: 'Jordan Singh' })).toBeVisible();
    // Quinn's adult confirmation opens one-to-one conversations; Ellis has neither a birth date nor one.
    await expect(sheet.getByRole('button', { name: 'Quinn Delisle' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Ellis Barrett' })).toHaveCount(0);
    await sheet.getByRole('radio', { name: 'A group' }).tap();
    await sheet.getByRole('button', { name: 'People' }).tap();
    await expect(sheet.getByRole('option', { name: /Ellis Barrett/ })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('guard: the picker lists the people they can write to', async ({ page }) => {
    await signInAs(page, 'STAFF');
    await open(page, '/messages');
    await page.getByRole('button', { name: 'New', exact: true }).tap();
    const sheet = page.locator('dialog[open]');
    await expect(sheet.getByRole('button', { name: 'Sam Okafor' })).toBeVisible();
    await sheet.getByRole('searchbox', { name: 'Find someone' }).fill('quinn');
    await expect(sheet.getByRole('button', { name: 'Quinn Delisle' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sam Okafor' })).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('HR: no birth date on file, so the record offers to confirm an adult; a confirmation shows who and how', async ({ page }) => {
    await signInAs(page, 'HR_ADMIN');
    // Ellis Barrett: treated as possibly a minor until HR confirms.
    await open(page, '/manage/staff/person?id=78e8a1d3-c781-48e8-91ff-33baed87e0fe');
    await expect(page.getByText('Confirmed adult (age of majority or older)')).toBeVisible();
    await expect(page.getByText(/^No birth date on file, so messaging treats Ellis as possibly a minor/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm adult' }).tap();
    await expect(page.getByLabel('How you confirmed it')).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    // Quinn Delisle: HR's confirmation, with its note.
    await open(page, '/manage/staff/person?id=81e9296f-88b6-4409-a679-8e916eed8ab2');
    await expect(page.getByText('Confirmed adult (age of majority or older)')).toBeVisible();
    await expect(page.getByText(/^Confirmed by Harper Reid on .*Driver’s licence seen at hiring/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove confirmation' })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('the HR record shows the birth date, so no adult confirmation is needed', async ({ page }) => {
    await signInAs(page, 'HR_ADMIN');
    // Morgan Lee: a birth date on file, which always wins over a confirmation.
    await open(page, '/manage/staff/person?id=02b5a8dd-d3ee-4455-aae4-348f1b303072');
    await expect(page.getByLabel('Date of birth')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByText('Confirmed adult (age of majority or older)')).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('en français : la note de sécurité, puis envoyer un message', async ({ page, baseURL }) => {
    const errors = watchErrors(page);
    await inFrench(page, baseURL);
    await signInAs(page, 'STAFF');
    await open(page, '/messages');
    const list = page.getByRole('region', { name: 'Conversations' });
    await expect(list.getByText(/La messagerie n’est pas faite pour les urgences\. En danger, composez le 911\./)).toBeVisible();
    // The department's French name.
    await list.getByRole('button', { name: /Aquatique/ }).tap();
    const thread = page.getByRole('region', { name: 'Conversation' });
    await expect(thread.getByRole('heading', { name: 'Aquatique' })).toBeVisible();
    await thread.getByRole('textbox', { name: 'Écrire un message' }).fill('Je peux prendre le quart de samedi.');
    await thread.getByRole('button', { name: 'Envoyer' }).tap();
    await expect(thread.getByText('Je peux prendre le quart de samedi.')).toBeVisible();
    await expect(thread.getByRole('button', { name: 'Retour aux conversations' })).toBeVisible();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
