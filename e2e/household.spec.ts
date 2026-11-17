import { test, expect } from "@playwright/test";
test("same compiler installs and invokes a household briefing MCP tool", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(page.getByText("MCP connected", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Program request" })
    .fill(
      "Summarize school updates daily and notify me with a family briefing.",
    );
  await page
    .getByRole("button", { name: "Build program", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & install" }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Permissions", exact: true }).click();
  await expect(
    page.getByText("notifications.write", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve & install" }).click();
  await expect(
    page.getByRole("button", { name: "Invoke via MCP" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Invoke via MCP" }).click();
  await expect(page.locator(".trace-header .status-pill")).toHaveText(
    "success",
  );
  await expect(page.locator(".trace-row")).toHaveCount(2);
  await page.screenshot({
    path: "artifacts/demo-household.png",
    fullPage: true,
  });
});
