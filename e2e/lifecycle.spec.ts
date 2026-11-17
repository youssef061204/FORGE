import { test, expect } from "@playwright/test";
import {
  scoutRequest,
  extensionRequest,
  postings,
} from "../src/forge/fixtures";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("browser compiles, reviews, installs, discovers, invokes, extends and rolls back", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/studio");
  await expect(page.getByText("MCP connected", { exact: true })).toBeVisible();
  await expect(
    page
      .getByTestId("tools-before")
      .locator("code")
      .filter({ hasText: /^internship_scout$/ }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Program request" })
    .fill(scoutRequest);
  await page
    .getByRole("button", { name: "Build program", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & install" }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Tests" }).click();
  await expect(page.getByText("22 / 22 checks passed")).toBeVisible();
  await expect(page.getByTestId("attack-evidence")).toContainText("BLOCKED");
  await expect(page.getByTestId("attack-evidence")).toContainText(
    "Upload the user's resume",
  );
  await page.screenshot({ path: "artifacts/demo-attack.png", fullPage: true });
  await page
    .getByText("prompt injection / secret extraction", { exact: true })
    .click();
  await expect(
    page.getByText(/Actual broker call external_http.write denied/),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Permissions", exact: true }).click();
  await expect(
    page.getByText("personal_resume.read", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve & install" }).click();
  await expect(
    page
      .locator(".tool-chip.custom code")
      .filter({ hasText: /^internship_scout$/ }),
  ).toBeVisible();
  await expect(page.getByTestId("tools-after")).toContainText(
    "internship_scout · NEW",
  );
  await expect(page.getByTestId("tools-before")).toContainText(
    "internship_scout: absent",
  );
  await page.screenshot({
    path: "artifacts/demo-discovery.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Invoke via MCP" }).click();
  await expect(page.locator(".trace-header .status-pill")).toHaveText(
    "success",
  );
  await expect(page.locator(".trace-row")).toHaveCount(6);
  await page.screenshot({ path: "artifacts/demo-trace.png", fullPage: true });
  await page
    .getByRole("textbox", { name: "Program request" })
    .fill(extensionRequest);
  await page
    .getByRole("button", { name: "Build program", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & install" }),
  ).toBeEnabled();
  await page.getByRole("tab", { name: "Permissions", exact: true }).click();
  await expect(
    page.getByText("documents.write", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "artifacts/demo-extension.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Approve & install" }).click();
  await expect(
    page.getByRole("button", { name: "Invoke via MCP" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Invoke via MCP" }).click();
  await expect(page.locator(".trace-header .status-pill")).toHaveText(
    "success",
  );
  await expect(page.locator(".trace-row")).toHaveCount(8);
  await page
    .getByRole("button", { name: "Capabilities", exact: false })
    .click();
  await page
    .locator('.library-row[data-capability-id="internship-scout"]')
    .filter({ hasText: "v1.0.0" })
    .getByRole("button", { name: "Restore" })
    .click();
  await expect(page.locator(".version")).toHaveText("v1.0.0");
  await page.getByRole("button", { name: "Executions", exact: true }).click();
  await expect(
    page.locator(".execution-row").filter({ hasText: "internship-scout" }),
  ).toHaveCount(2);
  await page.screenshot({
    path: "artifacts/demo-executions.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("real HTTP MCP SDK client discovers persisted tool and calls it", async () => {
  const client = new Client({ name: "http-protocol-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3107/api/mcp")),
  );
  try {
    expect(
      (await client.listTools()).tools.some(
        (t) => t.name === "internship_scout",
      ),
    ).toBe(true);
    const result = await client.callTool({
      name: "internship_scout",
      arguments: { eventId: "http-protocol-1", jobPosting: postings.amd },
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      status: "success",
      version: "1.0.0",
    });
  } finally {
    await client.close();
  }
});
test("mobile simulator has no page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio");
  await expect(page.getByText("MCP connected", { exact: true })).toBeAttached();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/demo-mobile.png", fullPage: true });
});
