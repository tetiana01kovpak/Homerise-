export default async ({ page, shot }) => {
  const id = process.env.EX ?? 'bungalow';
  await page.click(`[data-testid=example-${id}]`);
  await page.waitForTimeout(4000);
  await shot(`editor-${id}`);
  if (process.env.ROOF) { await page.getByText('Roof', { exact: true }).last().click(); await page.waitForTimeout(2500); await shot(`editor-${id}-roof`); }
};
