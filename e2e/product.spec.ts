import { test, expect } from "@playwright/test";
test("Home → MCP source build → replay → exact approval → execution → persistence → extension → Activity → revoke", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /what should your/i }),
  ).toBeVisible();
  await expect(
    page.getByText("DEVELOPMENT MODE", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Study mode", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Tell FORGE what you want")
    .fill("Keep my course deadline synchronized");
  await page.getByRole("button", { name: "Ask FORGE", exact: true }).click();
  await expect(
    page.getByText("Read-only replay", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("0 external writes", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve exact access" }).click();
  await page.getByRole("button", { name: "Run tool", exact: true }).click();
  await expect(
    page.getByText("TEST CONNECTOR RESULT", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /move controlled deadline/i }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "Tools", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /deadline watcher/i }),
  ).toBeVisible();
  await expect(page.getByText("v1.0.0", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page
    .getByLabel("Tell FORGE what you want")
    .fill("Keep my course deadline synchronized");
  await page.getByRole("button", { name: "Ask FORGE", exact: true }).click();
  await expect(page.getByText(/already installed/)).toBeVisible();
  await page
    .getByLabel("Tell FORGE what you want")
    .fill("Also move it to the following day");
  await page.getByRole("button", { name: "Ask FORGE", exact: true }).click();
  await expect(page.getByText("v1.1.0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve exact access" }).click();
  await page.getByRole("button", { name: "Run tool", exact: true }).click();
  await expect(
    page.getByText("TEST CONNECTOR RESULT", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.locator(".product-timeline article")).toHaveCount(2);
  await page.getByRole("link", { name: "Inspect", exact: true }).click();
  await page.getByText("Deadline watcher · v1.1.0").click();
  await expect(
    page.getByRole("heading", { name: "Program", exact: true }),
  ).toBeVisible();
  await expect(page.locator("details[open] pre")).toContainText(
    "function execute",
  );
  await page.getByRole("link", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByText("revoked", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page
    .getByLabel("Tell FORGE what you want")
    .fill("Play music while I study");
  await page.getByRole("button", { name: "Ask FORGE", exact: true }).click();
  await expect(
    page.getByText(/A connected music service is needed/),
  ).toBeVisible();
  await expect(page.getByText(/deterministic planner supports/)).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/product-browser/home-connection-needed.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: /Twin/ }).click();
  await expect(page.locator("canvas.city-canvas").first()).toBeVisible();
  await expect(page.getByText("WASD move")).toHaveCount(0);
});
