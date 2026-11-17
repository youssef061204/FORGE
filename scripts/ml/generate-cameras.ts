import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createCity,
  advanceCity,
  controlCity,
} from "../../src/forge/city-engine";
await mkdir("artifacts/ml/cameras", { recursive: true });
const compiled = await build({
  entryPoints: ["src/components/city-renderer.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "ForgeCityRenderer",
  write: false,
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 512, height: 320 },
  deviceScaleFactor: 1,
});
await page.setContent('<canvas id="camera" width="512" height="320"></canvas>');
await page.addScriptTag({ content: compiled.outputFiles[0].text });
const rows: unknown[] = [];
let index = 0;
try {
  for (const [split, count] of Object.entries({
    train: 100,
    validation: 20,
    heldout: 20,
    shift: 12,
    compositional: 8,
  }))
    for (let e = 0; e < count; e++) {
      const seed = 17500000 + index * 1399,
        city = createCity(seed);
      city.id = "camera-episode-" + index;
      const family = ["normal", "flood", "wildfire", "storm", "gas", "traffic"][
        e % 6
      ];
      const cameraNodes = [city.nodes[18], city.nodes[20], city.nodes[22]];
      const focus = cameraNodes[e % 3];
      if (family !== "normal")
        controlCity(city, {
          operation: "hazard.create",
          kind: family as "flood" | "wildfire" | "storm" | "gas" | "traffic",
          x: focus.x,
          y: focus.y,
          radius: 240,
          intensity: split === "shift" ? 0.95 : 0.55 + (e % 3) * 0.12,
        });
      if (family === "traffic" || e % 4 === 0) {
        controlCity(city, { operation: "traffic.add", count: 25 });
        controlCity(city, { operation: "traffic.add", count: 25 });
      }
      if (split === "compositional")
        controlCity(city, {
          operation: "hazard.create",
          kind: family === "wildfire" ? "flood" : "wildfire",
          x: focus.x + 60,
          y: focus.y + 30,
          radius: 260,
          intensity: 0.65,
        });
      for (let t = 0; t <= 100; t += 2) {
        if ([20, 50, 100].includes(t))
          for (const [camera, node] of cameraNodes.entries()) {
            const image = await page.evaluate(
              ({ state, cx, cy }) => {
                const c = document.querySelector<HTMLCanvasElement>("#camera")!,
                  ctx = c.getContext("2d")!;
                const player = {
                  x: cx,
                  y: cy,
                  vx: 0,
                  vy: 0,
                  moving: false,
                  sprint: false,
                  facing: "down",
                  sequence: 0,
                  overview: false,
                  camera: { x: cx, y: cy, zoom: 1.35 },
                };
                const renderer = (
                  window as unknown as {
                    ForgeCityRenderer: {
                      drawCity: (...args: unknown[]) => {
                        x: number;
                        y: number;
                        zoom: number;
                      };
                    };
                  }
                ).ForgeCityRenderer;
                const view = renderer.drawCity(
                  ctx,
                  state,
                  undefined,
                  1,
                  player,
                  512,
                  320,
                  175000 + state.seconds * 1000,
                  undefined,
                  undefined,
                  true,
                );
                return { image: c.toDataURL("image/png").split(",")[1], view };
              },
              { state: city, cx: node.x, cy: node.y },
            );
            const { x, y, zoom } = image.view;
            const bounds = {
              left: x - 256 / zoom,
              right: x + 256 / zoom,
              top: y - 160 / zoom,
              bottom: y + 160 / zoom,
            };
            const visible = (px: number, py: number) =>
              px >= bounds.left &&
              px <= bounds.right &&
              py >= bounds.top &&
              py <= bounds.bottom;
            const cells = city.terrain!.cells.filter((_, i) =>
              visible(((i % 28) + 0.5) * 80, (Math.floor(i / 28) + 0.5) * 80),
            );
            const roads = city.roads.filter((r) => {
              const a = city.nodes.find((n) => n.id === r.from)!,
                b = city.nodes.find((n) => n.id === r.to)!;
              return visible((a.x + b.x) / 2, (a.y + b.y) / 2);
            });
            const vehicleCount = city.vehicles.filter((v) =>
              visible(v.x, v.y),
            ).length;
            const labels = [
              Number(
                cells.some((c) => c.water > 0.15) ||
                  roads.some((r) => r.floodDepth > 0.15),
              ),
              Number(cells.some((c) => c.fire > 0.08)),
              Number(cells.some((c) => c.smoke > 0.03 || c.gas > 0.08)),
              Number(vehicleCount >= 8),
            ];
            const path = "cameras/" + city.id + "-" + t + "-" + camera + ".png";
            await writeFile(
              "artifacts/ml/" + path,
              Buffer.from(image.image, "base64"),
            );
            rows.push({
              episode: city.id,
              split,
              seed,
              scenario: family,
              seconds: t,
              camera: node.id,
              path,
              labels,
              // Independent ground truth stays in metadata; training receives pixels only.
              truth: {
                vehicleCount,
                maxWater: Math.max(0, ...cells.map((c) => c.water)),
                maxFire: Math.max(0, ...cells.map((c) => c.fire)),
                maxSmoke: Math.max(0, ...cells.map((c) => c.smoke)),
              },
              sensors: [
                Math.max(0, ...roads.map((r) => r.floodDepth)),
                Math.max(0, ...cells.map((c) => c.fire)),
                Math.max(
                  0,
                  ...cells.map((c) => c.smoke),
                  ...cells.map((c) => c.gas),
                ),
                vehicleCount / 12,
              ],
              bounds,
            });
          }
        if (t < 100) advanceCity(city, 2, false);
      }
      if (index % 20 === 0)
        console.log("Rendered camera episodes " + index + "/160");
      index++;
    }
} finally {
  await browser.close();
}
const encoded = JSON.stringify(rows);
await writeFile(
  "artifacts/ml/vision-dataset.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      episodes: index,
      frames: rows.length,
      labels: ["flood", "fire", "smoke", "congestion"],
      renderer:
        "actual Canvas drawCity, 512x320; no hazard names/forecast overlay",
      datasetHash: createHash("sha256").update(encoded).digest("hex"),
      rows,
    },
    null,
    2,
  ),
);
console.log("Camera dataset complete: " + rows.length + " rendered frames");
