import { test, expect } from "@playwright/test";
test("judge flow proves replay, owner grants, actual capsule integrity and fresh import trust", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/live");
  await page.getByRole("button", { name: "Build this program" }).click();
  await expect(
    page.getByText("I built and tested its source.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run Replay", exact: true }).click();
  await expect(
    page.getByText("Labeled fixture: 8/8 exact matches", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause replay", exact: true }).click();
  await page.screenshot({
    path: "artifacts/live-replay.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Approve tested program", exact: true })
    .click();
  await expect(
    page.getByText("Installed. Connector write access is still zero.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enable Shadow · no writes", exact: true })
    .click();
  await page.getByRole("button", { name: "Run Shadow", exact: true }).click();
  await expect(
    page.getByText("FIXTURE · SHADOW · 0 real external writes.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Approve exact permissions · FIXTURE",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Run Fixture", exact: true }).click();
  await expect(
    page.getByText("FIXTURE · LIVE · 0 real external writes.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revoke live access", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Run Fixture", exact: true }),
  ).toBeDisabled();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export .forgecap", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.forgecap$/);
  await page
    .getByRole("button", { name: "Test tampered copy", exact: true })
    .click();
  await expect(page.locator(".live-error[role=alert]")).toContainText(
    "CAPSULE REJECTED",
  );
  await expect(page.locator(".live-error[role=alert]")).toContainText(
    "hash mismatch",
  );
  await page
    .getByRole("button", {
      name: "Import exported copy · fresh local trust",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "Signature VALID · Local trust NOT ESTABLISHED · 0 inherited grants",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("0 active permission grants", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run Replay", exact: true }).click();
  await expect(
    page.getByText("Labeled fixture: 8/8 exact matches", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect FORGE", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Inspect FORGE evidence" });
  await expect(dialog).toContainText("function execute");
  await expect(dialog).toContainText("deadline_guardian");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "artifacts/live-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "LIVE GOOGLE", exact: true }).click();
  await page
    .getByRole("button", { name: "Connect Google read access", exact: true })
    .click();
  await expect(page.locator(".live-error[role=alert]")).toContainText(
    "Google OAuth is not configured",
  );
  expect(errors).toEqual([]);
});
