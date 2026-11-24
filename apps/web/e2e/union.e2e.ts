import { expect, test } from '@playwright/test';
import { inFrench, open, sideways, signInAs } from './helpers';

test.describe('union steward', () => {
  test('reads the overtime order from the menu, without the supervisor’s controls', async ({ page }) => {
    await signInAs(page, 'UNION_STEWARD');
    await expect(page).toHaveURL(/\/union\/?$/);
    await open(page, '/manage/overtime');
    await expect(page.getByRole('heading', { name: 'Who’s next' })).toBeVisible();
    await expect(page.getByRole('table').getByRole('row')).not.toHaveCount(1);
    await expect(page.getByText('Read only: supervisors record call-outs and set the rule.', { exact: false })).toBeVisible();
    await expect(page.getByText('What counts as charged')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record a call' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });

  test('en français', async ({ page, baseURL }) => {
    await inFrench(page, baseURL);
    await signInAs(page, 'UNION_STEWARD');
    await open(page, '/manage/overtime');
    await expect(page.getByText('Lecture seule : les superviseurs consignent les appels et fixent la règle.', { exact: false })).toBeVisible();
  });
});
