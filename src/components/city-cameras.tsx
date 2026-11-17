"use client";
import { useEffect, useRef, useState } from "react";
import type { City } from "@/forge/city-contracts";
import { drawCity } from "./city-renderer";
import { CityController } from "./city-controller";
import {
  cameraPredict,
  cameraLabels,
  fuseCamera,
} from "@/forge/vision-runtime";
export function CityCameras({ city }: { city: City }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    current = useRef(city);
  const [camera, setCamera] = useState(0),
    [fault, setFault] = useState("clean");
  const [result, setResult] = useState<{
    camera: number[];
    fused: number[];
    duration: number;
  }>();
  useEffect(() => {
    current.current = city;
  }, [city]);
  useEffect(() => {
    const tick = () => {
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext("2d")!,
        state = current.current;
      const node = state.nodes[[18, 20, 22][camera] % state.nodes.length];
      const viewer = new CityController();
      viewer.x = node.x;
      viewer.y = node.y;
      viewer.camera = { x: node.x, y: node.y, zoom: 1.35 };
      drawCity(
        ctx,
        state,
        undefined,
        1,
        viewer,
        512,
        320,
        performance.now(),
        undefined,
        undefined,
        true,
      );
      if (fault === "obscured") {
        ctx.fillStyle = "#161b20";
        ctx.fillRect(0, 0, 512, 160);
      }
      const small = document.createElement("canvas");
      small.width = 64;
      small.height = 64;
      const sc = small.getContext("2d")!;
      sc.drawImage(c, 0, 0, 64, 64);
      const prediction = cameraPredict(sc.getImageData(0, 0, 64, 64).data);
      const cells =
        state.terrain?.cells.filter(
          (_, i) =>
            Math.hypot(
              (i % 28) * 80 + 40 - node.x,
              Math.floor(i / 28) * 80 + 40 - node.y,
            ) < 150,
        ) ?? [];
      const max = (key: "water" | "fire" | "smoke" | "gas") =>
        Math.max(0, ...cells.map((p) => p[key]));
      let sensors = [
        max("water"),
        max("fire"),
        Math.max(max("smoke"), max("gas")),
        state.vehicles.filter(
          (v) => Math.hypot(v.x - node.x, v.y - node.y) < 170,
        ).length / 12,
      ];
      if (fault === "missing") sensors = [0, 0, 0, 0];
      if (fault === "spoof") sensors = sensors.map((v) => 1 - v);
      setResult({
        camera: prediction.probabilities,
        fused: fuseCamera(
          prediction.probabilities,
          sensors,
          fault === "obscured" ? 0.5 : 1,
          fault === "missing" || fault === "spoof" ? 0 : 1,
        ),
        duration: prediction.durationMs,
      });
    };
    tick();
    const timer = setInterval(tick, 1500);
    return () => clearInterval(timer);
  }, [camera, fault]);
  return (
    <div className="city-camera">
      <p>
        Virtual cameras render actual City pixels. A trained CNN sees only the
        image; a separate model combines camera estimates and structured
        sensors.
      </p>
      <select
        aria-label="Camera location"
        value={camera}
        onChange={(e) => setCamera(Number(e.target.value))}
      >
        {[0, 1, 2].map((n) => (
          <option key={n} value={n}>
            Camera {n + 1}
          </option>
        ))}
      </select>
      <select
        aria-label="Camera fault"
        value={fault}
        onChange={(e) => setFault(e.target.value)}
      >
        {["clean", "obscured", "missing", "spoof"].map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
      <canvas
        ref={canvas}
        role="img"
        width={512}
        height={320}
        style={{ width: "100%", height: "auto" }}
        aria-label="Virtual camera feed"
      />
      <table>
        <thead>
          <tr>
            <th>Estimate</th>
            <th>Camera</th>
            <th>Combined</th>
          </tr>
        </thead>
        <tbody>
          {cameraLabels.map((label, i) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{Math.round(100 * (result?.camera[i] ?? 0))}%</td>
              <td>{Math.round(100 * (result?.fused[i] ?? 0))}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Inference {result?.duration.toFixed(1)} ms. Synthetic perception, never
        execution authority. The congestion camera head failed held-out testing
        (F1 0); do not rely on it. Fault flags are controlled test inputs.
      </p>
    </div>
  );
}
