export default async ({ page, shot }) => {
  const id = process.env.EX ?? 'modern2';
  await page.click(`[data-testid=example-${id}]`);
  await page.waitForTimeout(1200);
  await page.click('text=3D >> nth=0'); await page.waitForTimeout(1500);
  // zoom in with the wheel over the canvas
  const c = await page.locator('[data-testid=view3d] canvas').boundingBox();
  await page.mouse.move(c.x + c.width * 0.45, c.y + c.height * 0.5);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -250); await page.waitForTimeout(60); }
  await page.waitForTimeout(1500); await shot(`w-${id}-zoom`);
  await page.click('[aria-label="Walk through"]'); await page.waitForTimeout(2500); await shot(`w-${id}-walk`);
  // turn: simulate keyboard walking forward
  await page.keyboard.down('KeyS'); await page.waitForTimeout(900); await page.keyboard.up('KeyS');
  await page.waitForTimeout(800); await shot(`w-${id}-walk2`);
};
