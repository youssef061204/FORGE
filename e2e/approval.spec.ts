import { test, expect } from "@playwright/test";

test("runtime and genuine build progress are visible; owner can inspect and reject", async ({
  page,
  request,
}) => {
  const goal =
    "Summarize community safety notices and notify me with a briefing.";
  await page.goto("/studio");
  await expect(page.locator(".proof-details summary")).toContainText(
    "2025-11-25",
  );
  await expect(page.getByText("MCP connected", { exact: true })).toBeVisible();
  await expect(page.getByTestId("runtime-info")).toContainText(
    "Deterministic Fixture Compiler",
  );
  await page.getByRole("textbox", { name: "Program request" }).fill(goal);
  await page
    .getByRole("button", { name: "Build program", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & install" }),
  ).toBeEnabled();
  await expect(page.getByTestId("build-progress")).toContainText(
    "Running security checks",
  );
  await expect(page.getByTestId("approval-card")).toContainText(
    "YOUR APPROVAL IS REQUIRED",
  );
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Permissions", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("REJECTED", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Invoke via MCP" }),
  ).toHaveCount(0);
  const state = await (await request.get("/api/forge")).json();
  expect(
    state.releases.find(
      (release: { definition: { intent: string } }) =>
        release.definition.intent === goal,
    ).status,
  ).toBe("rejected");
});

test("HTTP route negotiates 2025-11-25 and enforces transport/access boundaries", async ({
  request,
}) => {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
  };
  const initialized = await request.post("/api/mcp", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: "wire-init",
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "browser-wire-proof", version: "1" },
      },
    },
  });
  expect(initialized.status()).toBe(200);
  expect((await initialized.json()).result.protocolVersion).toBe("2025-11-25");
  expect((await initialized.json()).result.capabilities.tools.listChanged).toBe(
    false,
  );
  expect(initialized.headers()["mcp-session-id"]).toBeUndefined();
  expect((await request.get("/api/mcp")).status()).toBe(405);
  expect((await request.delete("/api/mcp")).status()).toBe(405);
  expect(
    (
      await request.post("/api/mcp", {
        headers: { ...headers, Origin: "https://attacker.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  const batch = await request.post("/api/mcp", {
    headers,
    data: [{ jsonrpc: "2.0", id: 3, method: "tools/list" }],
  });
  expect(batch.status()).toBe(400);
  expect((await batch.json()).error.code).toBe(-32600);
});
