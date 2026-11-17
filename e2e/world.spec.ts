import { test, expect } from "@playwright/test";
import { worldRequests } from "../src/forge/world";

test("World: unavailable music is explained and a study paraphrase can be forged", async ({
  page,
}) => {
  await page.goto("/world");
  await expect(page.getByText("MCP connected", { exact: true })).toBeVisible();
  const input = page.getByRole("textbox", { name: "World program request" });
  const error = page
    .getByRole("region", { name: "Ask FORGE", exact: true })
    .getByRole("alert");
  await expect(input).toHaveAccessibleDescription(
    /Music playback is not connected/,
  );
  await input.fill("Play music when studying");
  await page
    .getByRole("button", { name: "Forge capability", exact: true })
    .click();
  await expect(error).toContainText(
    "Music playback is not connected to FORGE World",
  );
  await expect(error).not.toContainText("Select Bedrock");
  await expect(
    page.getByRole("button", { name: "Approve & install", exact: true }),
  ).toHaveCount(0);
  await input.fill("Set things up while I am studying");
  await page
    .getByRole("button", { name: "Forge capability", exact: true })
    .click();
  await expect(page.getByTestId("world-proposal")).toContainText("Study Mode");
  await expect(
    page.getByRole("button", { name: "Approve & install", exact: true }),
  ).toBeEnabled();
  await expect(error).toHaveCount(0);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(
    page.getByText("Proposal rejected. World and installed tools unchanged.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("World: actual MCP creation, approval, effects, delivery block, night arrival, extension and rollback", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/world");
  await expect(page.getByText("MCP connected", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "artifacts/world-before.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Forge capability", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & install", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Inspect MCP", exact: true }).click();
  await expect(page.getByTestId("world-tools-before")).not.toContainText(
    "leaving_home",
  );
  await expect(page.getByTestId("world-tools-after")).not.toContainText(
    "leaving_home",
  );
  await page
    .getByRole("button", { name: "Close Inspect MCP", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve & install", exact: true })
    .click();
  await page.getByRole("button", { name: "Inspect MCP", exact: true }).click();
  await expect(page.getByTestId("world-tools-after")).toContainText(
    "leaving_home",
  );
  await page
    .getByRole("button", { name: "Close Inspect MCP", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run leaving_home", exact: true })
    .click();
  await expect(page.getByTestId("world-door")).toHaveText("Locked");
  await expect(page.getByTestId("world-presence")).toHaveText("Away");
  await expect(page.getByTestId("world-temperature")).toHaveText("21°C");
  await expect(page.getByTestId("world-lights")).toHaveText("0/5 lights on");
  await page.getByRole("button", { name: "Mail & Guard" }).click();
  await page
    .getByRole("button", { name: "Test malicious delivery", exact: true })
    .click();
  await expect(page.getByText("THREAT BLOCKED", { exact: true })).toBeVisible();
  await expect(page.getByTestId("world-door")).toHaveText("Locked");
  await page.screenshot({
    path: "artifacts/world-threat.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Scene inputs", exact: true }).click();
  await page.getByRole("button", { name: "Night arrival" }).click();
  await page
    .getByRole("textbox", { name: "World program request" })
    .fill(worldRequests.welcome);
  await page
    .getByRole("button", { name: "Forge capability", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & install", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Approve & install", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run welcome_home", exact: true })
    .click();
  await expect(page.getByTestId("world-presence")).toHaveText("Home");
  await expect(page.getByTestId("world-lights")).toHaveText("2/5 lights on");
  await page.screenshot({
    path: "artifacts/world-night.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("textbox", { name: "World program request" })
    .fill(worldRequests.study);
  await page
    .getByRole("button", { name: "Forge capability", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve & install", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run study_mode", exact: true })
    .click();
  await expect(page.getByTestId("world-avatar")).toHaveAttribute(
    "data-state",
    "studying",
  );
  await expect(page.getByText("Computer on", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "artifacts/world-study.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Teach Leaving Home something new" })
    .click();
  await page
    .getByRole("button", { name: "Forge capability", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & install", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("world-proposal")).toContainText("v1.1.0");
  await page
    .getByRole("button", { name: "Approve & install", exact: true })
    .click();
  await page.getByRole("button", { name: "Scene inputs", exact: true }).click();
  await page.getByRole("button", { name: "Away for 45 min" }).click();
  await page
    .getByRole("button", { name: "Run leaving_home", exact: true })
    .click();
  await expect(page.getByTestId("world-temperature")).toHaveText("18°C");
  await expect(page.getByText("TV off", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Rollback to v1.0.0", exact: true })
    .click();
  await page.getByRole("button", { name: "Scene inputs", exact: true }).click();
  await page.getByRole("button", { name: "Away for 45 min" }).click();
  await page
    .getByRole("button", { name: "Run leaving_home", exact: true })
    .click();
  await expect(page.getByTestId("world-temperature")).toHaveText("21°C");
  await expect(page.getByText("TV on", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/world-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Demo mode", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Demo mode", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: "artifacts/world-cinematic.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Scene inputs", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset World demo", exact: true })
    .click();
  await expect(page.getByTestId("world-temperature")).toHaveText("24°C");
  await expect(page.getByTestId("world-presence")).toHaveText("Home");
  await expect(page.getByTestId("world-lights")).toHaveText("5/5 lights on");
  await expect(
    page.getByText("THREAT BLOCKED", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Inspect MCP", exact: true }).click();
  await expect(page.getByTestId("world-tools-after")).not.toContainText(
    "leaving_home",
  );
  await expect(page.getByTestId("world-tools-after")).not.toContainText(
    "welcome_home",
  );
  const reduced = await page.evaluate(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  expect(reduced).toBe(false);
  await page
    .getByRole("button", { name: "Close Inspect MCP", exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .getByTestId("world-avatar")
      .locator(".avatar-route")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  expect(errors).toEqual([]);
});
