export default async ({ page, shot }) => {
  await page.click('[data-testid=example-farmhouse]');
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Export")'); await page.waitForTimeout(500); await shot('dlg-export');
  await page.keyboard.press('Escape');
  await page.click('[aria-label=Settings]'); await page.waitForTimeout(400); await shot('dlg-settings');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__homerise.getState().set({ startOpen: true }));
  await page.setInputFiles('[data-testid=start-file]', 'tests/fixtures/plans/bungalow.png');
  await page.waitForTimeout(800); await shot('dlg-import');
};
