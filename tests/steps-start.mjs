export default async ({ page, shot }) => {
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.start').scrollTo(0, 99999));
  await page.waitForTimeout(500);
  await shot('start-bottom');
};
