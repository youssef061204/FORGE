import type { City, FutureFrame } from "@/forge/city-contracts";
import type { CityController } from "./city-controller";
import type { CityForecast } from "@/forge/world-model";
const colors = {
  grass: "#8da88e",
  road: "#515a56",
  sidewalk: "#bec5ad",
  water: "#7caebb",
  ink: "#344943",
};
const palette: Record<string, [string, string]> = {
  home: ["#d5cbb6", "#9eaa94"],
  office: ["#c4c9ba", "#708d83"],
  hospital: ["#eee7d4", "#a45d55"],
  fire: ["#d3b597", "#a46451"],
  police: ["#bec3b5", "#536e78"],
  shelter: ["#d4cca9", "#99ab73"],
  school: ["#d2bfa2", "#a08872"],
  substation: ["#bdc2ae", "#7e8b69"],
  plant: ["#c1c4b5", "#7d8a7f"],
  industrial: ["#bec0af", "#778274"],
  transit: ["#d9cdb2", "#b29867"],
  foundry: ["#e7d5b6", "#8b9266"],
};
export type CityViewport = { x: number; y: number; zoom: number };
const scenery = new Map<string, HTMLCanvasElement>();
function ground(city: City) {
  const key = city.id;
  const existing = scenery.get(key);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = city.width;
  canvas.height = city.height;
  const c = canvas.getContext("2d")!;
  c.fillStyle = colors.grass;
  c.fillRect(0, 0, city.width, city.height);
  for (let x = 0; x < city.width; x += 32)
    for (let y = 0; y < city.height; y += 32) {
      c.fillStyle = (x * 13 + y * 17) % 7 < 3 ? "#9eb39a" : "#819c85";
      c.fillRect(x + 4, y + 9, 4, 3);
    }
  // Pocket parks, paths, benches and waterfront retain one physical pixel scale.
  for (const [x, y] of [
    [720, 1030],
    [1515, 1370],
    [710, 170],
    [35, 660],
  ]) {
    c.fillStyle = "#739b75";
    c.fillRect(x, y, 150, 130);
    c.fillStyle = "#c1c1a0";
    c.fillRect(x + 16, y + 57, 124, 10);
    c.fillRect(x + 68, y + 12, 10, 107);
    c.fillStyle = "#6e6951";
    c.fillRect(x + 32, y + 42, 24, 5);
    c.fillRect(x + 105, y + 77, 24, 5);
    c.fillStyle = "#a9c7b8";
    c.fillRect(x + 83, y + 18, 37, 25);
  }
  for (let i = 0; i < 170; i++) {
    const x = 35 + ((i * 137) % 2160),
      y = 60 + ((i * 227) % 1480);
    if (
      city.buildings.some(
        (b) =>
          x > b.x - 20 &&
          x < b.x + b.w + 20 &&
          y > b.y - 25 &&
          y < b.y + b.h + 50,
      ) ||
      city.nodes.some(
        (n) => Math.abs(x - n.x) < 42 || Math.abs(y - n.y) < 42,
      ) ||
      (x > 1044 && x < 1204)
    )
      continue;
    c.fillStyle = "#647d57";
    c.fillRect(x - 8, y + 14, 20, 8);
    c.fillStyle = "#775f48";
    c.fillRect(x, y + 4, 5, 17);
    c.fillStyle = "#50765b";
    c.fillRect(x - 12, y - 6, 29, 22);
    c.fillStyle = "#78a179";
    c.fillRect(x - 8, y - 14, 21, 18);
    c.fillStyle = "#91b087";
    c.fillRect(x - 5, y - 12, 10, 5);
  }
  if (scenery.size > 4) scenery.clear();
  scenery.set(key, canvas);
  return canvas;
}
function drawFields(ctx: CanvasRenderingContext2D, city: City, time: number) {
  for (const [i, c] of (city.terrain?.cells ?? []).entries()) {
    const x = (i % 28) * 80,
      y = Math.floor(i / 28) * 80;
    if (c.water > 0.025) {
      ctx.fillStyle =
        "rgba(53,124,158," + Math.min(0.8, 0.15 + c.water * 0.35) + ")";
      ctx.fillRect(x, y, 80, 80);
      ctx.strokeStyle = "rgba(164,218,222," + Math.min(0.6, c.water) + ")";
      ctx.lineWidth = 2;
      for (let r = 0; r < 3; r++) {
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 15 + r * 22 + Math.sin(time / 550 + i + r) * 3);
        ctx.lineTo(x + 68, y + 15 + r * 22);
        ctx.stroke();
      }
    }
    if (c.fire > 0.045)
      for (let f = 0; f < 6; f++) {
        const fx = x + 12 + ((f * 29) % 62),
          fy = y + 17 + ((f * 37) % 60),
          flame = 6 + c.fire * 26 + Math.sin(time / 90 + i + f) * 6;
        ctx.fillStyle = "#a75037";
        ctx.fillRect(fx - 4, fy - 4, 12, 14);
        ctx.fillStyle = "#e68943";
        ctx.fillRect(fx, fy - flame, 7, flame + 8);
        ctx.fillStyle = "#f3ca71";
        ctx.fillRect(fx + 1, fy - flame * 0.5, 3, flame * 0.5);
        ctx.fillStyle = "rgba(255,180,98,.6)";
        ctx.fillRect(
          fx + Math.sin(time / 300 + f) * 12,
          fy - ((time / 18 + f * 13) % 60),
          2,
          2,
        );
      }
    if (c.smoke > 0.025 || c.gas > 0.03) {
      const opacity = Math.min(0.6, c.smoke * 0.45 + c.gas * 0.5);
      ctx.fillStyle =
        c.gas > c.smoke
          ? "rgba(172,165,99," + opacity + ")"
          : "rgba(66,71,65," + opacity + ")";
      for (let s = 0; s < 3; s++) {
        ctx.beginPath();
        ctx.ellipse(
          x + 25 + s * 17 + Math.sin(time / 1600 + i) * 9,
          y + 22 + s * 13,
          25 + s * 9,
          18 + s * 8,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
    if (c.damage > 0.3) {
      ctx.strokeStyle = "rgba(91,74,51," + c.damage * 0.4 + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y + 20);
      ctx.lineTo(x + 30, y + 45);
      ctx.lineTo(x + 48, y + 36);
      ctx.lineTo(x + 72, y + 70);
      ctx.stroke();
    }
  }
}
export function viewportFor(
  city: City,
  player: CityController,
  width: number,
  height: number,
): CityViewport {
  const zoom = player.overview
    ? Math.min(width / (city.width + 80), height / (city.height + 100))
    : (player.zoom ?? 1.35);
  const target = {
    x: player.overview
      ? city.width / 2
      : Math.max(
          width / zoom / 2,
          Math.min(city.width - width / zoom / 2, player.x),
        ),
    y: player.overview
      ? city.height / 2
      : Math.max(
          height / zoom / 2,
          Math.min(city.height - height / zoom / 2, player.y),
        ),
    zoom,
  };
  player.camera ??= target;
  const alpha = player.overview ? 0.18 : 0.12;
  player.camera = {
    x: player.camera.x + (target.x - player.camera.x) * alpha,
    y: player.camera.y + (target.y - player.camera.y) * alpha,
    zoom: player.camera.zoom + (target.zoom - player.camera.zoom) * alpha,
  };
  return player.camera;
}
export function drawCity(
  ctx: CanvasRenderingContext2D,
  city: City,
  previous: City | undefined,
  interpolation: number,
  player: CityController,
  width: number,
  height: number,
  time: number,
  selected?: string,
  branch?: FutureFrame,
  demo = false,
  forecast?: CityForecast,
) {
  if (branch)
    city = {
      ...city,
      nodes: branch.nodes ?? city.nodes,
      roads: city.roads.map((r) => ({
        ...r,
        ...branch.roads?.find((a) => a.id === r.id),
      })),
      buildings: city.buildings.map((b) => ({
        ...b,
        ...branch.buildings?.find((a) => a.id === b.id),
      })),
      weather: branch.weather ?? city.weather,
      clockMinutes: branch.clockMinutes ?? city.clockMinutes,
      metrics: branch.metrics,
      terrain: branch.terrain ?? city.terrain,
    };
  const view = viewportFor(city, player, width, height);
  const nodesById = new Map(city.nodes.map((n) => [n.id, n]));
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#d5dfcf";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  const earthquake = (branch?.hazards ?? city.hazards).find(
    (h) => h.active && h.kind === "earthquake" && h.age < 24,
  );
  const shake = earthquake
    ? earthquake.intensity * (1 - earthquake.age / 24) * 5
    : 0;
  ctx.translate(
    width / 2 + Math.sin(time / 27) * shake,
    height / 2 + Math.cos(time / 34) * shake,
  );
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-view.x, -view.y);
  ctx.drawImage(ground(city), 0, 0);
  if (!city.map) {
    ctx.fillStyle = "#acc1a5";
    ctx.fillRect(1044, 0, 160, city.height);
    ctx.fillStyle = colors.water;
    ctx.fillRect(1094, 0, 54, city.height);
    ctx.fillStyle = "#a4c4c8";
    for (let y = 0; y < city.height; y += 43)
      ctx.fillRect(
        1101 + Math.sin(time / 2500 + y) * 7,
        y + ((time / 80) % 43),
        26,
        3,
      );
  }
  for (const road of city.roads) {
    const a = nodesById.get(road.from)!,
      b = nodesById.get(road.to)!;
    if (road.bridge && ![390, 910, 1430].includes(a.y)) continue;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = 60;
    ctx.strokeStyle = colors.sidewalk;
    ctx.stroke();
    ctx.lineWidth = 40;
    ctx.strokeStyle = road.closed
      ? "#797665"
      : road.damage > 0.3
        ? "#696054"
        : colors.road;
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 14]);
    ctx.strokeStyle = "#c5c1a1";
    ctx.stroke();
    ctx.setLineDash([]);
    if (road.bridge) {
      ctx.strokeStyle = "#d7cbae";
      ctx.lineWidth = 4;
      for (const offset of [-25, 25]) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y + offset);
        ctx.lineTo(b.x, b.y + offset);
        ctx.stroke();
      }
    }
    if (road.floodDepth > 0.1) {
      ctx.lineWidth = 36;
      ctx.strokeStyle =
        "rgba(86,153,181," + Math.min(0.8, road.floodDepth) + ")";
      ctx.stroke();
    }
    if (road.closed) {
      const x = (a.x + b.x) / 2,
        y = (a.y + b.y) / 2;
      ctx.fillStyle = "#c9ae79";
      ctx.fillRect(x - 16, y - 5, 32, 10);
      ctx.fillStyle = "#6a5945";
      for (let i = -12; i < 16; i += 10) ctx.fillRect(x + i, y - 5, 4, 10);
    }
  }
  for (const node of city.nodes) {
    ctx.fillStyle = colors.road;
    ctx.fillRect(node.x - 20, node.y - 20, 40, 40);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = "#d9d6bc";
      ctx.fillRect(node.x - 14 + i * 8, node.y - 33, 4, 8);
    }
    ctx.fillStyle = "#34443d";
    ctx.fillRect(node.x + 25, node.y - 30, 6, 15);
    ctx.fillStyle =
      node.powered === false
        ? "#57625b"
        : node.signal === "ns"
          ? "#a7d288"
          : node.signal === "emergency"
            ? "#e2b86c"
            : "#cc7463";
    ctx.fillRect(node.x + 26, node.y - 28, 4, 4);
  }
  for (const b of [...city.buildings].sort((a, b) => a.y + a.h - b.y - b.h)) {
    const [wall, roof] = palette[b.kind] ?? palette.home;
    ctx.fillStyle = "rgba(42,65,48,.19)";
    ctx.fillRect(b.x + 12, b.y + 14, b.w, b.h);
    ctx.fillStyle = "#60745a";
    ctx.fillRect(b.x - 4, b.y + 10, b.w + 8, b.h + 5);
    ctx.fillStyle = wall;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = roof;
    ctx.fillRect(b.x + 5, b.y - 8, b.w - 10, b.h - 20);
    ctx.fillStyle = "#afbaa4";
    ctx.fillRect(b.x + 10, b.y - 5, b.w - 20, 4);
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = b.power < 0.3 ? "#58675d" : "#dbd7a9";
        ctx.fillRect(b.x + 16 + col * 32, b.y + 16 + row * 33, 13, 16);
        ctx.fillStyle = "#7a8d7c";
        ctx.fillRect(b.x + 21 + col * 32, b.y + 16 + row * 33, 3, 16);
      }
    ctx.fillStyle = "#546e60";
    ctx.fillRect(b.x + b.w / 2 - 9, b.y + b.h - 22, 18, 22);
    if (b.kind === "hospital") {
      ctx.fillStyle = "#e5d8bd";
      ctx.fillRect(b.x + 51, b.y + 32, 46, 46);
      ctx.fillStyle = "#b16c60";
      ctx.fillRect(b.x + 68, b.y + 39, 12, 32);
      ctx.fillRect(b.x + 58, b.y + 49, 32, 12);
    }
    if (b.kind === "foundry") {
      ctx.fillStyle = "#ede4c7";
      ctx.font = "bold 29px monospace";
      ctx.fillText("F", b.x + 65, b.y + 65);
    }
    if (b.kind === "plant" || b.kind === "industrial") {
      ctx.fillStyle = "#7f8f7d";
      ctx.fillRect(b.x + 15, b.y - 30, 17, 40);
      ctx.fillRect(b.x + 46, b.y - 45, 17, 55);
    }
    if (b.kind === "substation") {
      ctx.strokeStyle = "#536853";
      ctx.lineWidth = 4;
      for (let col = 0; col < 3; col++) {
        ctx.strokeRect(b.x + 17 + col * 38, b.y + 20, 24, 60);
        ctx.fillStyle = "#a9bfa1";
        ctx.fillRect(b.x + 20 + col * 38, b.y + 16, 18, 8);
      }
    }
    if (b.kind === "fire" || b.kind === "police" || b.kind === "transit") {
      ctx.fillStyle = "#6a7d75";
      for (let bay = 0; bay < 3; bay++) {
        ctx.fillRect(b.x + 14 + bay * 42, b.y + b.h - 43, 31, 38);
        ctx.fillStyle = "#9eae97";
        ctx.fillRect(b.x + 16 + bay * 42, b.y + b.h - 40, 27, 3);
        ctx.fillStyle = "#6a7d75";
      }
    }
    if (b.generatorActive) {
      ctx.fillStyle = "#ecd795";
      ctx.fillRect(b.x + b.w - 20, b.y + b.h - 24, 13, 17);
      ctx.fillStyle = "#76a16a";
      ctx.fillRect(b.x + b.w - 17, b.y + b.h - 20, 6, 4);
    }
    if (b.damage > 0.1) {
      ctx.fillStyle = "rgba(91,58,40," + b.damage * 0.65 + ")";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = "#6c5346";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x + 65, b.y);
      ctx.lineTo(b.x + 82, b.y + 45);
      ctx.lineTo(b.x + 65, b.y + 84);
      ctx.stroke();
    }
    if (selected === b.id) {
      ctx.strokeStyle = "#fff4b7";
      ctx.lineWidth = 5;
      ctx.strokeRect(b.x - 9, b.y - 16, b.w + 18, b.h + 24);
    }
    if (!demo || b.critical || ["foundry", "shelter"].includes(b.kind)) {
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#e8ead8";
      ctx.fillRect(b.x - 5, b.y + b.h + 8, b.w + 10, 24);
      ctx.fillStyle = colors.ink;
      ctx.fillText(
        b.name.length > 19 ? b.name.slice(0, 18) : b.name,
        b.x + b.w / 2,
        b.y + b.h + 25,
      );
      ctx.textAlign = "left";
    }
  }
  // Decorative trees stay out of building collision and road graphs.
  for (let i = 0; i < 0; i++) {
    const x = 35 + ((i * 137) % 2160),
      y = 60 + ((i * 227) % 1480);
    if (
      city.buildings.some(
        (b) =>
          x > b.x - 20 &&
          x < b.x + b.w + 20 &&
          y > b.y - 25 &&
          y < b.y + b.h + 50,
      ) ||
      city.nodes.some(
        (n) => Math.abs(x - n.x) < 42 || Math.abs(y - n.y) < 42,
      ) ||
      (x > 1044 && x < 1204)
    )
      continue;
    ctx.fillStyle = "#7a8e66";
    ctx.fillRect(x - 8, y + 14, 20, 8);
    ctx.fillStyle = "#775f48";
    ctx.fillRect(x, y + 4, 5, 17);
    ctx.fillStyle = "#577f63";
    ctx.fillRect(x - 12, y - 6, 29, 22);
    ctx.fillStyle = "#6c9570";
    ctx.fillRect(x - 8, y - 14, 21, 18);
  }
  const vehicles = branch?.vehicles ?? city.vehicles;
  for (const v of vehicles) {
    const old = !branch
      ? previous?.vehicles.find((a) => a.id === v.id)
      : undefined;
    const x = old ? old.x + (v.x - old.x) * interpolation : v.x,
      y = old ? old.y + (v.y - old.y) * interpolation : v.y;
    const responder = ["ambulance", "fire", "police"].includes(v.kind);
    ctx.fillStyle = "rgba(30,42,31,.25)";
    ctx.fillRect(x - 9, y - 3, v.kind === "bus" ? 30 : 21, 12);
    ctx.fillStyle =
      v.kind === "ambulance"
        ? "#ebe6d2"
        : v.kind === "fire"
          ? "#b95e4f"
          : v.kind === "police"
            ? "#42677b"
            : v.kind === "bus"
              ? "#c9aa6f"
              : (["#d0c1a0", "#699296", "#ba8f78", "#a8b699"][
                  Number(v.id.split("-").at(-1)) % 4
                ] ?? "#a8b699");
    ctx.fillRect(x - 10, y - 8, v.kind === "bus" ? 29 : 20, 10);
    ctx.fillStyle = "#4d615c";
    ctx.fillRect(x - 5, y - 6, 7, 5);
    if (responder) {
      ctx.fillStyle = Math.floor(time / 300) % 2 ? "#db7d70" : "#92c4d9";
      ctx.fillRect(x - 1, y - 10, 5, 3);
    }
  }
  for (const p of branch?.pedestrians ?? city.pedestrians) {
    const old = !branch
      ? previous?.pedestrians.find((a) => a.id === p.id)
      : undefined;
    const x = old ? old.x + (p.x - old.x) * interpolation : p.x,
      y = old ? old.y + (p.y - old.y) * interpolation : p.y;
    ctx.fillStyle = p.evacuated ? "#b8db81" : "#596a6c";
    ctx.fillRect(x - 2, y - 4, 5, 6);
    ctx.fillStyle = "#dfc99d";
    ctx.fillRect(x - 2, y - 7, 5, 4);
  }
  drawFields(ctx, city, time);
  if (forecast && !branch)
    for (const prediction of forecast.nodes) {
      const n = nodesById.get(prediction.nodeId)!;
      const values = prediction.values;
      if (
        values.water > 0.15 ||
        values.fire > 0.12 ||
        prediction.outageProbability > 0.2 ||
        prediction.blockedProbability > 0.4
      ) {
        ctx.fillStyle =
          values.fire > 0.12
            ? "rgba(214,115,55,.2)"
            : values.water > 0.15
              ? "rgba(84,158,202,.24)"
              : "rgba(156,97,187,.17)";
        ctx.strokeStyle = forecast.lowConfidence
          ? "#a8a79a"
          : values.water > 0.15
            ? "#91c8de"
            : "#dbb683";
        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(n.x, n.y, 105, 85, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "12px monospace";
        ctx.fillStyle = "#f2f2e4";
        ctx.fillText(
          values.water > 0.15
            ? values.water.toFixed(2) + " m"
            : prediction.outageProbability > 0.2
              ? Math.round(prediction.outageProbability * 100) + "% outage"
              : "Forecast",
          n.x - 30,
          n.y + 5,
        );
      }
    }
  for (const h of branch?.hazards ?? city.hazards) {
    if (!h.active) continue;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
    ctx.fillStyle =
      h.kind === "flood" || h.kind === "storm"
        ? "rgba(73,138,174,.20)"
        : h.kind === "wildfire" || h.kind === "gas"
          ? "rgba(192,118,67,.22)"
          : "rgba(115,91,124,.2)";
    if (h.kind === "traffic" || h.kind === "earthquake") ctx.fill();
    ctx.strokeStyle = h.kind === "flood" ? "#789fbc" : "#b9906a";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 10]);
    if (h.kind === "gas" || h.kind === "traffic") ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 12; i++) {
      const x = h.x + Math.sin(i * 7.4) * h.radius * 0.7,
        y = h.y + Math.cos(i * 5.2) * h.radius * 0.7;
      if (h.kind === "earthquake" && h.age < 35) {
        ctx.fillStyle =
          "rgba(201,183,147," + Math.max(0, 0.6 - h.age / 60) + ")";
        ctx.fillRect(x + Math.sin(time / 400 + i) * 20, y - h.age * 2, 34, 18);
      } else if (h.kind === "wildfire") {
        ctx.fillStyle = "#e2ae60";
        ctx.fillRect(x, y - 5 - Math.sin(time / 180 + i) * 5, 7, 16);
        ctx.fillStyle = "#b2684c";
        ctx.fillRect(x - 2, y + 3, 11, 8);
      } else if (h.kind === "tornado" || h.kind === "gas") {
        ctx.fillStyle = "rgba(145,148,133,.5)";
        ctx.fillRect(x + Math.sin(time / 500 + i) * 12, y, 20, 14);
      }
    }
    if (h.kind === "tornado") {
      for (let ring = 0; ring < 14; ring++) {
        const angle = time / 140 + ring * 0.9,
          radius = 12 + ring * 4;
        ctx.fillStyle = "rgba(105,116,112," + (0.7 - ring * 0.025) + ")";
        ctx.beginPath();
        ctx.ellipse(
          h.x + Math.sin(angle) * 8,
          h.y - ring * 7,
          radius,
          7 + ring,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.fillStyle = "#8b7760";
        ctx.fillRect(
          h.x + Math.cos(angle) * radius * 1.5,
          h.y - ring * 7 + Math.sin(angle) * 12,
          5,
          3,
        );
      }
    }
    if (h.kind === "traffic") {
      ctx.fillStyle = "#a6594b";
      ctx.fillRect(h.x - 21, h.y - 8, 25, 12);
      ctx.fillStyle = "#c3a879";
      ctx.fillRect(h.x + 5, h.y - 1, 22, 12);
      ctx.fillStyle = Math.floor(time / 350) % 2 ? "#efbc77" : "#b37c51";
      ctx.fillRect(h.x - 3, h.y - 21, 6, 6);
    }
    ctx.font = "bold 17px monospace";
    ctx.fillStyle = "#4f4d40";
    if (!demo)
      ctx.fillText(h.kind.toUpperCase(), h.x - 45, h.y - h.radius - 12);
  }
  const night = Math.max(
    0,
    Math.cos(((city.clockMinutes - 120) / 1440) * Math.PI * 2),
  );
  if (night > 0.1) {
    ctx.fillStyle = "rgba(20,39,60," + night * 0.38 + ")";
    ctx.fillRect(0, 0, city.width, city.height);
    for (const n of city.nodes) {
      if (n.powered === false) continue;
      ctx.fillStyle = "rgba(240,212,141,.32)";
      ctx.fillRect(n.x - 2, n.y - 8, 5, 7);
    }
  }
  ctx.restore();
  if (forecast) {
    ctx.fillStyle = "#edf3eced";
    ctx.fillRect(width / 2 - 166, 18, 332, 43);
    ctx.fillStyle = "#536c65";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("FORECAST +" + forecast.horizon + " sec", width / 2, 36);
    ctx.font = "10px monospace";
    ctx.fillText(
      forecast.lowConfidence
        ? "Confidence low · Full simulation required"
        : "Predicted conditions · 95% intervals in resource view",
      width / 2,
      51,
    );
    ctx.textAlign = "left";
  }
  if (city.weather.cloud > 0.5) {
    ctx.fillStyle = "rgba(43,54,64," + (city.weather.cloud - 0.5) * 0.24 + ")";
    ctx.fillRect(0, 0, width, height);
    if (
      city.hazards.some((h) => h.active && h.kind === "storm") &&
      time % 7800 < 90
    ) {
      ctx.fillStyle = "rgba(230,240,239,.26)";
      ctx.fillRect(0, 0, width, height);
    }
  }
  if (city.weather.rain > 0.15) {
    ctx.strokeStyle = "rgba(207,222,221," + city.weather.rain * 0.65 + ")";
    ctx.lineWidth = 1;
    for (let i = 0; i < Math.round(city.weather.rain * 180); i++) {
      const x = (i * 83 + time / 23) % width,
        y = (i * 139 + time / 5) % height;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 12);
      ctx.stroke();
    }
  }
  return view;
}
