import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.FORGE_BASE_URL ?? "http://127.0.0.1:3115");
  await page.locator("canvas").waitFor();
  await page.waitForTimeout(2000);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/city-browser.png", fullPage: true });
  const canvas = page.locator("canvas"),
    before = await canvas.getAttribute("data-player-x");
  await canvas.focus();
  await page.keyboard.down("d");
  await page.waitForTimeout(600);
  await page.keyboard.up("d");
  const after = await canvas.getAttribute("data-player-x");
  const typingBefore = after;
  await page
    .getByRole("textbox", { name: "Ask FORGE" })
    .fill("Walking while typing must not move the player");
  await page.keyboard.type("ddddwwww");
  const typingAfter = await canvas.getAttribute("data-player-x");
  await writeFile(
    "artifacts/city-browser-observation.json",
    JSON.stringify(
      {
        errors,
        playerMoved: before !== after,
        typingIgnored: typingBefore === typingAfter,
        viewport: { width: 1440, height: 900 },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      errors,
      playerMoved: before !== after,
      typingIgnored: typingBefore === typingAfter,
    }),
  );
} finally {
  await browser.close();
}
