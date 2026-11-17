import { test, expect, type Page } from "@playwright/test";
import {
  checkpointName,
  coreGoals,
  coreOwnerToken,
  memoName,
} from "./helpers/core-responses";
import { CoreBrowserServer, coreOrigin } from "./helpers/core-server";

test.describe.configure({ mode: "serial" });
const server = new CoreBrowserServer();

async function authenticate(page: Page, path = "/") {
  await page.goto(coreOrigin + path);
  await expect(page.locator(".product-error")).toContainText(
    "Authentication required",
  );
  await page.getByRole("button", { name: "Enter access token" }).click();
  await page.getByLabel("Owner API token").fill(coreOwnerToken);
  await expect(page.locator(".product-error")).toHaveCount(0);
}

async function ask(page: Page, goal: string) {
  await page.getByLabel("Tell FORGE what you want").fill(goal);
  await page.getByRole("button", { name: "Ask FORGE", exact: true }).click();
}

test.beforeAll(async () => server.start());
test.afterAll(async () => server.stop());

test("1 novel generation compiles, approves and executes", async ({ page }) => {
  await authenticate(page);
  await ask(page, coreGoals.novel);
  await expect(
    page.getByRole("heading", { name: new RegExp(memoName, "i") }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve exact access" }).click();
  await page.getByRole("button", { name: "Run tool", exact: true }).click();
  await expect(page.getByText("Declared outcome checks passed.")).toBeVisible();
});

test("2 exact request reuses the installed tool", async ({ page }) => {
  await authenticate(page);
  await ask(page, coreGoals.novel);
  await expect(page.getByText(/already installed/i)).toBeVisible();
});

test("3 follow-up extends v1.0 to v1.1", async ({ page }) => {
  await authenticate(page);
  await ask(page, coreGoals.extend);
  await expect(page.getByText("v1.1.0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve exact access" }).click();
  await page.getByRole("button", { name: "Run tool", exact: true }).click();
  await expect(page.getByText("Declared outcome checks passed.")).toBeVisible();
});

test("4 one tool coordinates workspace and notification connectors", async ({
  page,
}) => {
  await authenticate(page);
  await ask(page, coreGoals.multiple);
  await expect(
    page.getByRole("heading", { name: new RegExp(checkpointName, "i") }),
  ).toBeVisible();
  await expect(
    page.getByText("Save a downloadable local file", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Notify me", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve exact access" }).click();
  await page.getByRole("button", { name: "Run tool", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Created acceptance-checkpoint.txt",
  );
  await expect(page.getByRole("status")).toContainText(
    "Outcome not independently verified.",
  );
});

test("5 missing external service requests a connection", async ({ page }) => {
  await authenticate(page);
  await ask(page, coreGoals.missing);
  await expect(
    page.getByText(/connected music service is needed/i),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve exact access" }),
  ).toHaveCount(0);
});

test("6 ambiguous request asks a material clarification", async ({ page }) => {
  await authenticate(page);
  await ask(page, coreGoals.clarify);
  await expect(page.getByText(/which schedule should change/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve exact access" }),
  ).toHaveCount(0);
});

test("7 malformed generation is contained before installation", async ({
  page,
}) => {
  await authenticate(page);
  await ask(page, coreGoals.invalid);
  await expect(page.getByText(/could not build a working tool/i)).toBeVisible();
  await expect(page.getByText(/nothing was installed/i)).toBeVisible();
});

test("8 connector failure is reported as failed, never verified", async ({
  page,
}) => {
  await server.fillWorkspaceCapacity();
  await authenticate(page, "/tools");
  const tool = page.locator("article.product-tool", {
    hasText: checkpointName,
  });
  await tool.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("status")).toHaveClass(/failed/);
  await expect(page.getByRole("status")).toContainText(
    "Workspace output capacity is full",
  );
  await expect(page.getByRole("status")).not.toContainText(
    "Declared outcome checks passed.",
  );
});

test("9 owner revocation disables execution", async ({ page }) => {
  await authenticate(page, "/tools");
  const tool = page
    .locator("article.product-tool", { hasText: memoName })
    .first();
  await tool.getByRole("button", { name: "Revoke access" }).click();
  await expect(tool.getByText("revoked", { exact: true })).toBeVisible();
  await expect(
    tool.getByRole("button", { name: "Run", exact: true }),
  ).toHaveCount(0);
});

test("10 persisted tool is reusable after an actual server restart", async ({
  page,
}) => {
  await server.restart();
  await authenticate(page);
  await ask(page, coreGoals.multiple);
  await expect(page.getByText(/already installed/i)).toBeVisible();
  expect(new Set(server.processIds).size).toBe(2);
});
