import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("Actual local model creates, installs and reuses a file tool through the same MCP runtime", async ({
  page,
  request,
}) => {
  await mkdir("artifacts/local-synthesis", { recursive: true });
  const client = new Client({
    name: "forge-local-browser-proof",
    version: "1",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://127.0.0.1:3111/api/mcp")),
  );
  try {
    async function waitForReview() {
      const alert = page.locator(".product-home .product-error[role=alert]");
      await Promise.race([
        expect(
          page.getByText("Read-only replay", { exact: true }),
        ).toBeVisible(),
        alert.waitFor({ state: "visible", timeout: 180000 }).then(async () => {
          throw new Error(
            "Actual local compiler failed: " + (await alert.innerText()),
          );
        }),
      ]);
    }
    const t0 = (await client.listTools()).tools.map((tool) => tool.name);
    expect(t0.some((name) => name.startsWith("tool_"))).toBe(false);
    await page.goto("/");
    await expect(page.getByText("LOCAL MODEL", { exact: true })).toBeVisible();
    await page.getByLabel("Upload a file").setInputFiles({
      name: "orders.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "item,quantity,price\nNotebook,4,5\nPen,6,2\nLamp,3,25\n",
      ),
    });
    await expect(
      page.locator(".workspace-files").getByText("orders.csv", { exact: true }),
    ).toBeVisible();
    const goal =
      "Read orders.csv and save totals.json containing a JSON object mapping each item name to quantity times price as numbers. Compute the values from the rows; include every item.";
    await page.getByLabel("Tell FORGE what you want").fill(goal);
    await page.getByRole("button", { name: "Ask FORGE", exact: true }).click();
    await waitForReview();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      t0,
    );
    await page.getByRole("button", { name: "Approve exact access" }).click();
    await expect(
      page.getByRole("button", { name: "Run tool", exact: true }),
    ).toBeEnabled();
    const t1 = (await client.listTools()).tools.map((tool) => tool.name);
    const newTool = t1.find((name) => name.startsWith("tool_"));
    expect(newTool).toBeTruthy();
    await page.getByRole("button", { name: "Run tool", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download totals.json", exact: true })
      .click();
    const download = await downloadPromise;
    expect(
      JSON.parse(await readFile((await download.path())!, "utf8")),
    ).toEqual({ Notebook: 20, Pen: 12, Lamp: 75 });
    await page.screenshot({
      path: "artifacts/local-synthesis/browser-result.png",
      fullPage: true,
    });
    const firstState = await (await request.get("/api/product")).json();
    const tool = firstState.programs[0];
    expect(tool.usage.provider).toBe("ollama-local");
    expect(tool.grants).toEqual(tool.permissions);
    await page.reload();
    await page.getByRole("link", { name: "Tools", exact: true }).click();
    await expect(page.getByText("v1.0.0", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Download totals.json", exact: true }),
    ).toBeVisible();
    const mcp = await client.callTool({
      name: newTool!,
      arguments: { eventId: "actual-local-mcp" },
    });
    expect(mcp.isError).not.toBe(true);
    expect(mcp.structuredContent).toMatchObject({ status: "done" });
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await page.getByLabel("Tell FORGE what you want").fill(goal);
    await page.getByRole("button", { name: "Ask FORGE", exact: true }).click();
    await expect(page.getByText(/already installed/)).toBeVisible();
    const reused = await (await request.get("/api/product")).json();
    expect(reused.programs).toHaveLength(1);
    await page.getByRole("link", { name: "Tools", exact: true }).click();
    await page.getByRole("link", { name: "Edit tool", exact: true }).click();
    await page
      .getByLabel("Tell FORGE what you want")
      .fill(
        "Update that tool: keep calculating every item's quantity times price from orders.csv. Also include a numeric grandTotal key equal to the sum of all item totals in the same totals.json object. Compute everything from the rows.",
      );
    await page.getByRole("button", { name: "Ask FORGE", exact: true }).click();
    await waitForReview();
    const beforeExtensionApproval = await (
      await request.get("/api/product")
    ).json();
    const extension = beforeExtensionApproval.programs.find(
      (program: { status: string }) => program.status === "review",
    );
    expect(extension.version).toBe("1.1.0");
    expect(extension.parentHash).toBe(tool.hash);
    expect(extension.grants).toEqual([]);
    expect(extension.permissions).toEqual(tool.permissions);
    await page.getByRole("button", { name: "Approve exact access" }).click();
    await expect(
      page.getByRole("button", { name: "Run tool", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Run tool", exact: true }).click();
    const extensionDownloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download totals.json", exact: true })
      .click();
    const extensionDownload = await extensionDownloadPromise;
    expect(
      JSON.parse(await readFile((await extensionDownload.path())!, "utf8")),
    ).toEqual({ Notebook: 20, Pen: 12, Lamp: 75, grandTotal: 107 });
    await page.getByRole("link", { name: "Tools", exact: true }).click();
    await expect(page.getByText("v1.1.0", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Revoke access" }).click();
    await expect(page.getByText("revoked", { exact: true })).toBeVisible();
    expect(
      (await client.listTools()).tools.some((value) => value.name === newTool),
    ).toBe(false);
    const revoked = await client.callTool({
      name: newTool!,
      arguments: { eventId: "revoked-proof" },
    });
    expect(revoked.isError).toBe(true);
    await writeFile(
      "artifacts/local-synthesis/browser-proof.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          paidRequests: 0,
          provider: tool.usage.provider,
          model: tool.usage.model,
          usage: tool.usage,
          t0,
          t1,
          installedTool: newTool,
          sourceHash: tool.hash,
          permissions: tool.permissions,
          output: { Notebook: 20, Pen: 12, Lamp: 75 },
          persistedAfterRefresh: true,
          toolsRunSucceeded: true,
          actualMcpInvocation: true,
          reuseWithoutNewProgram: true,
          naturalExtension: {
            version: extension.version,
            parentHash: extension.parentHash,
            hash: extension.hash,
            freshApproval: true,
            output: { Notebook: 20, Pen: 12, Lamp: 75, grandTotal: 107 },
          },
          revocationBlocked: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
});
