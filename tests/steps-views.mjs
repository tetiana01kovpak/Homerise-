export default async ({ page, shot }) => {
  const id = process.env.EX ?? 'bungalow';
  await page.click(`[data-testid=example-${id}]`);
  await page.waitForTimeout(1500);
  await page.click('text=2D >> nth=0'); await page.waitForTimeout(800); await shot(`v-${id}-2d`);
  await page.click('text=3D >> nth=0'); await page.waitForTimeout(2500); await shot(`v-${id}-3d`);
  // select a room to show properties
  await page.evaluate(() => { const st = window.__homerise.getState(); const r = st.project.levels.find((l) => l.id === st.project.activeLevelId).rooms.find((x) => x.type === 'living'); st.select({ kind: 'room', id: r.id }); });
  await page.click('text=2D >> nth=0'); await page.waitForTimeout(600); await shot(`v-${id}-room`);
};
