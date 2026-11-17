// Records the README animation from a real recorded build on the Forge Floor.
// node scripts/record-gif.mjs http://127.0.0.1:3110 docs/images/forge-floor.gif
import { chromium } from "@playwright/test";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { PNG } from "pngjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [base, out = "docs/images/forge-floor.gif"] = process.argv.slice(2);
const W = 1100, H = 680;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const frames = [];
const grab = async (delay, hold = 1) => {
  const png = PNG.sync.read(await page.screenshot());
  for (let i = 0; i < hold; i++) frames.push({ data: png.data, delay });
};
await page.goto(`${base}/forge/tape-orders-1`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "2×" }).click();
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  await grab(450);
  if (await page.getByText("Permission passport").isVisible().catch(() => false)) break;
  await page.waitForTimeout(250);
}
await grab(1200);
await page.getByRole("tab", { name: "preview" }).click();
await page.waitForTimeout(500);
await grab(1500);
await page.locator("table").nth(1).locator("tbody tr").nth(1).click();
await page.waitForTimeout(500);
await grab(2600);
await page.getByRole("tab", { name: "approve" }).click();
await page.waitForTimeout(500);
await grab(3200);
await browser.close();

const gif = GIFEncoder();
for (const f of frames) {
  const palette = quantize(f.data, 128, { format: "rgb565" });
  const index = applyPalette(f.data, palette, "rgb565");
  gif.writeFrame(index, W, H, { palette, delay: f.delay });
}
gif.finish();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gif.bytes());
console.log(`${frames.length} frames → ${out} (${Math.round(gif.bytes().length / 1024)} KB)`);
