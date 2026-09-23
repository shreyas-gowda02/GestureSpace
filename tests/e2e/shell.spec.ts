import { expect, test } from '@playwright/test';

test('app shell renders with all seven experiences', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Experiences' })).toBeVisible();
  const dock = page.getByRole('navigation', { name: 'Experiences' }).getByRole('button');
  await expect(dock).toHaveCount(7);
});

test('number keys switch experiences', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('3');
  await expect(page.getByRole('button', { name: /Air Draw/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
