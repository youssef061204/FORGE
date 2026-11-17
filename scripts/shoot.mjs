// Screenshots for design review: node scripts/shoot.mjs <base> <path>[=name[=waitMs]] ...
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [base, ...targets] = process.argv.slice(2);
mkdirSync("artifacts/shots", { recursive: true });
const browser = await chromium.launch();
for (const [w, h, tag] of [[1440, 900, "desk"], [390, 844, "phone"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  for (const t of targets) {
    const [path, name, wait] = t.split("=");
    try {
      await page.goto(base + path, { waitUntil: "networkidle", timeout: 60000 });
    } catch (e) {
      console.log("goto", path, e.message.slice(0, 120));
    }
    await page.waitForFunction(() => document.body.innerText.length > 50, null, { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(Number(wait ?? 1500));
    await page.screenshot({ path: `artifacts/shots/${name ?? (path.replace(/\W+/g, "_") || "home")}-${tag}.png`, fullPage: process.env.FULL === "1" });
  }
  await page.close();
}
await browser.close();
