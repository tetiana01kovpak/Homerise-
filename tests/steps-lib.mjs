export default async ({ page, shot }) => {
  await page.click('[data-testid=example-apt2]');
  await page.waitForTimeout(1200);
  await page.click('[data-testid=tool-item]');
  await page.waitForTimeout(2500);
  await shot('lib-all');
  await page.evaluate(() => { const st = window.__homerise.getState(); const l = st.project.levels[0]; const it = l.items.find((i) => /sofa/.test(i.catalogId)); st.set({ tool: 'select', panel: 'library' }); st.select({ kind: 'item', id: it.id }); });
  await page.waitForTimeout(1200);
  await shot('lib-item-selected');
};
