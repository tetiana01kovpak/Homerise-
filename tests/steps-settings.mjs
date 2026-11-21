export default async ({ page, shot }) => {
  await page.click('[data-testid=example-farmhouse]');
  await page.waitForTimeout(1000);
  console.log('count', await page.locator('[aria-label=Settings]').count());
  await page.click('[aria-label=Settings]');
  await page.waitForTimeout(400);
  console.log('open', await page.evaluate(() => window.__homerise.getState().settingsOpen));
  await shot('dlg-settings');
};
