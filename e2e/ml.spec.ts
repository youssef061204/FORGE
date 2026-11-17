import { test, expect } from "@playwright/test";
test("Forecast promotion/rollback, real map and virtual camera remain owner-scoped", async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post("/api/environment", {
        data: {
          action: "control",
          change: { operation: "pause", paused: true },
        },
      })
    ).ok(),
  ).toBe(true);
  const base = await (await request.get("/api/environment?forecast=60")).json();
  expect(base.forecast.label).toBe("FORECAST");
  expect(base.forecast.nodes.length).toBeGreaterThan(0);
  const promote = await request.post("/api/environment", {
    data: { action: "model", variant: "queue-adapted-2" },
  });
  expect(promote.ok()).toBe(true);
  const promoted = await (
    await request.get("/api/environment?forecast=60")
  ).json();
  expect(promoted.forecast.version).toBe("queue-adapted-2");
  expect(
    promoted.forecast.nodes.map(
      (n: { values: { queue: number } }) => n.values.queue,
    ),
  ).not.toEqual(
    base.forecast.nodes.map(
      (n: { values: { queue: number } }) => n.values.queue,
    ),
  );
  expect(promoted.modelLifecycle.active).toBe("queue-adapted-2");
  expect(promoted.modelLifecycle.events.at(-1).modelHash).toMatch(
    /^[0-9a-f]{64}$/,
  );
  expect(
    (
      await request.post("/api/environment", {
        data: { action: "model", variant: "base" },
      })
    ).ok(),
  ).toBe(true);
  const rolledBack = await (
    await request.get("/api/environment?forecast=60")
  ).json();
  expect(
    rolledBack.forecast.nodes.map(
      (n: { values: { queue: number } }) => n.values.queue,
    ),
  ).toEqual(
    base.forecast.nodes.map(
      (n: { values: { queue: number } }) => n.values.queue,
    ),
  );
  const map = await request.post("/api/environment", {
    data: { action: "map", name: "kingston" },
  });
  expect(map.ok()).toBe(true);
  const imported = await (await request.get("/api/environment")).json();
  expect(imported.city.map.source).toBe("OpenStreetMap");
  expect(imported.city.map.simulatedConditions).toBe(true);
  expect(imported.city.deployment).toBeUndefined();
  expect(imported.city.nodes.length).toBe(64);
  expect(
    (
      await request.post("/api/environment", {
        data: { action: "map", name: "northbank" },
      })
    ).ok(),
  ).toBe(true);
  const restored = await (await request.get("/api/environment")).json();
  expect(restored.city.id).toBe(base.city.id);
  expect(restored.city.deployment).toBeUndefined();
  expect(
    (
      await request.post("/api/environment", {
        data: {
          action: "control",
          change: { operation: "pause", paused: false },
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/twin");
  await page.getByRole("button", { name: "Open context inspector" }).click();
  await page.getByRole("tab", { name: "CAMERAS", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Virtual camera feed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Camera", exact: true }),
  ).toBeVisible();
});
