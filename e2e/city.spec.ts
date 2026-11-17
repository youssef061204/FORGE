import { test, expect } from "@playwright/test";
test("Twin pan, zoom, typing isolation and pause use the actual canvas", async ({
  page,
}) => {
  await page.goto("/twin");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(canvas).not.toHaveAttribute("data-player-x");
  await canvas.focus();
  await page.keyboard.press("d");
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 80,
    bounds.y + bounds.height / 2 + 40,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.mouse.wheel(0, -120);
  await page
    .getByRole("textbox", { name: "Ask FORGE" })
    .fill("w a s d are text in the composer");
  await expect(canvas).not.toHaveAttribute("data-player-x");
  await canvas.focus();
  await page.keyboard.press("0");
  await expect(page.getByText("WASD move")).toHaveCount(0);
  await page.getByRole("button", { name: "Pause City", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume City", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume City", exact: true }).click();
  await page.screenshot({ path: "artifacts/city-browser-controls.png" });
});
test("MCP goal generates sources, measured Futures, owner admission and invocation; attack blocks and changed state survives", async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/twin");
  await expect(page.locator("canvas")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Ask FORGE" })
    .fill("Development fixture proof for congestion, exposure and energy");
  await page.getByRole("button", { name: "Submit goal", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve & run", exact: true }),
  ).toBeVisible({ timeout: 180000 });
  await page.getByRole("tab", { name: "FUTURES", exact: true }).click();
  await expect(page.locator(".candidate-evidence")).toHaveCount(3);
  await expect(page.locator(".candidate-evidence .passed")).toHaveCount(60);
  await page
    .getByRole("button", { name: "View recorded branch", exact: true })
    .click();
  await expect(page.locator(".branch-banner")).toBeVisible();
  await page
    .locator(".branch-banner")
    .getByRole("button", { name: "Return to current City" })
    .click();
  await page
    .getByRole("button", { name: "City controls", exact: true })
    .click();
  const weatherChanged = page.waitForResponse((response) => {
    if (
      !response.url().endsWith("/api/environment") ||
      response.request().method() !== "POST"
    )
      return false;
    return (
      response.request().postDataJSON()?.change?.operation === "weather.set"
    );
  });
  await page
    .getByRole("button", { name: "Toggle storm weather", exact: true })
    .click();
  expect((await weatherChanged).ok()).toBe(true);
  const changed = (await (await request.get("/api/environment")).json()).city;
  await page
    .getByRole("button", { name: "Close world controls", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve & run", exact: true })
    .click();
  await expect(page.locator(".new-tool")).toBeVisible();
  await expect(page.locator(".new-tool")).toContainText("INSTALLED");
  const after = (await (await request.get("/api/environment")).json()).city;
  expect(after.weather.rain).toBe(changed.weather.rain);
  expect(after.revision).toBeGreaterThanOrEqual(changed.revision);
  await page
    .getByRole("button", { name: "Invoke new MCP tool", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "TRACE", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".trace-entry").first()).toContainText("success");
  await page.getByRole("tab", { name: "TRUST", exact: true }).click();
  await page
    .getByRole("button", { name: "Add a red-team observation", exact: true })
    .click();
  await expect(
    page.getByText("BLOCKED / ACTUAL BROKER TRACE", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".attack-evidence").last()).toContainText(
    "critical infrastructure power floor",
  );
  const attacked = (await (await request.get("/api/environment")).json()).city;
  expect(attacked.metrics.hospitalPower).toBeGreaterThanOrEqual(0.9);
  const evidence = await (await request.get("/api/environment")).json();
  expect(
    evidence.executions.findLast(
      (e: { outcome: { securityProbe?: boolean } }) => e.outcome.securityProbe,
    )?.outcome.currentCityUnchanged,
  ).toBe(true);
  await page.screenshot({ path: "artifacts/city-browser-attack.png" });
  expect(errors).toEqual([]);
});
