// Opens each of the 10 examples, captures split view + 3D-with-roof views.
const IDS = (process.env.IDS ?? 'studio,apt2,bungalow,modern2,farmhouse,villa,basement,tiny,townhouse,large').split(',');
export default async ({ page, shot }) => {
  for (const id of IDS) {
    await page.goto(process.env.URL ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
    await page.click(`[data-testid=example-${id}]`);
    await page.waitForTimeout(2500);
    if (process.env.SPLIT) await shot(`ex-${id}-split`);
    await page.click('text=3D >> nth=0');
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /Roof/ }).last().click();
    await page.waitForTimeout(2500);
    await shot(`ex-${id}-3d`);
    const score = await page.locator('.section-title:has-text("Plan check") span').last().textContent().catch(() => '?');
    console.log(id, 'plan check', score);
  }
};
