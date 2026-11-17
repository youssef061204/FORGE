import { expect, test, type Page } from "@playwright/test";

// The webServer runs with FORGE_MODEL_TRANSPORT=scripted: builds are labeled SCRIPTED.

async function hold(page: Page, name: RegExp) {
  const seal = page.getByRole("button", { name });
  await seal.scrollIntoViewIfNeeded();
  const box = (await seal.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
}

async function forge(page: Page, sample: RegExp, request: string) {
  await page.goto("/");
  // Wait for hydration: the status pill only renders on the client.
  await expect(page.getByText("Scripted model")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: sample }).click();
  await page.locator("#request").fill(request);
  await page.getByRole("button", { name: /^Forge it$/ }).click();
  await expect(page).toHaveURL(/\/forge\/b_/, { timeout: 90_000 });
  await expect(page.getByText("SCRIPTED").first()).toBeVisible();
}

test("build, approve, run and revoke", async ({ page }) => {
  await forge(page, /Shop orders/, "Total sales by item, as quantity times price. Save totals.json mapping each item to its total.");
  await expect(page.getByText("Permission passport")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "test" }).click();
  await expect(page.getByText("outvoted").first()).toBeVisible();
  await page.getByRole("tab", { name: "approve" }).click();
  await hold(page, /Hold to approve/);
  await expect(page.getByRole("link", { name: "Run it" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Run it" }).click();
  await page.getByRole("button", { name: /^Run$/ }).click();
  await expect(page.getByText(/Wrote totals.json/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name: "Access" }).click();
  await hold(page, /Hold to revoke/);
  await expect(page.getByText("Revoked.")).toBeVisible();
  await page.getByRole("tab", { name: "Run" }).click();
  await expect(page.getByText("This tool can't run")).toBeVisible();
});

test("disambiguate: FORGE asks which reading was meant, and the answer becomes an example", async ({ page }) => {
  await forge(page, /Contacts with duplicates/, "Clean up contacts.csv and save clean-contacts.csv");
  await expect(page.getByText("Which did you mean?").first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "This one" }).first().click();
  await expect(page.getByText("Confirmed examples")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Permission passport")).toBeVisible({ timeout: 30_000 });
});

test("fix by example rebuilds with the correction as a hard constraint", async ({ page }) => {
  await forge(page, /Contacts with duplicates/, "Remove duplicate contacts: treat emails as the same when they only differ in case or spaces, keep the first row. Save clean-contacts.csv.");
  await expect(page.getByText("Permission passport")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "preview" }).click();
  await page.getByRole("button", { name: /Fix it by example/ }).click();
  await page.getByRole("button", { name: "Remove row 1", exact: true }).click();
  await page.getByRole("button", { name: "Rebuild to match this" }).click();
  await expect(page).toHaveURL(/\/forge\/b_/);
  // No scripted draft reproduces the corrected result, so the build ends honestly as a failure.
  await expect(page.getByText(/does not reproduce the confirmed example/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Not built")).toBeVisible({ timeout: 60_000 });
});

test("a request needing an unconnected service ends as CONNECT with no program", async ({ page }) => {
  await forge(page, /Shop orders/, "Email this file to boss@example.test every Monday");
  await expect(page.getByText("FORGE can't do this yet")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Needs: Send email")).toBeVisible();
});
