"use client";
import { useEffect, useRef } from "react";
import type { City, FutureFrame } from "@/forge/city-contracts";
import { CityController, typingTarget } from "./city-controller";
import { drawCity, type CityViewport } from "./city-renderer";
import type { CityForecast } from "@/forge/world-model";
type Props = {
  city: City;
  selected?: string;
  branch?: FutureFrame;
  demo: boolean;
  onSelect: (id: string) => void;
  onInspector: () => void;
  onPause: () => void;
  onClose?: () => void;
  onChat?: () => void;
  readOnly?: boolean;
  label?: string;
  forecast?: CityForecast;
};
export function CityCanvas(props: Props) {
  const { city, readOnly = false, label } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(props);
  const controller = useRef(new CityController());
  const projection = useRef<CityViewport>({ x: 1120, y: 800, zoom: 0.5 });
  const observed = useRef<{ current: City; previous?: City; at: number }>({
    current: city,
    at: 0,
  });
  const pointer = useRef<
    { id: number; x: number; y: number; dragged: boolean } | undefined
  >(undefined);
  useEffect(() => {
    live.current = props;
    if (observed.current.current.revision !== city.revision)
      observed.current = {
        current: city,
        previous: observed.current.current,
        at: performance.now(),
      };
  }, [props, city]);
  useEffect(() => {
    const element = canvas.current!;
    const context = element.getContext("2d")!;
    let width = 1,
      height = 1,
      frame = 0,
      last = performance.now(),
      measuredAt = last;
    const intervals: number[] = [];
    controller.current.overview = true;
    controller.current.x = live.current.city.width / 2;
    controller.current.y = live.current.city.height / 2;
    const resize = new ResizeObserver((entries) => {
      const bounds = entries[0].contentRect;
      width = bounds.width;
      height = bounds.height;
      const dpr = Math.min(window.devicePixelRatio, 2);
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = false;
    });
    resize.observe(element);
    const wheel = (event: WheelEvent) => {
      if (live.current.readOnly) return;
      event.preventDefault();
      const camera = controller.current;
      camera.overview = false;
      camera.zoom = Math.max(
        0.25,
        Math.min(
          2.5,
          projection.current.zoom * Math.exp(-event.deltaY * 0.002),
        ),
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    const key = (event: KeyboardEvent) => {
      if (live.current.readOnly || typingTarget(event.target)) return;
      if (event.key === "Escape") live.current.onClose?.();
      if (event.key === "0" && document.activeElement === element) {
        controller.current.overview = true;
        controller.current.camera = undefined;
      }
    };
    window.addEventListener("keydown", key);
    function render(now: number) {
      const state = live.current;
      const elapsed = now - last;
      last = now;
      if (elapsed > 0 && elapsed < 1000) {
        intervals.push(elapsed);
        if (intervals.length > 900) intervals.shift();
      }
      projection.current = drawCity(
        context,
        state.city,
        observed.current.previous,
        Math.min(1, (now - observed.current.at) / 1000),
        controller.current,
        width,
        height,
        now,
        state.selected,
        state.branch,
        state.demo,
        state.forecast,
      );
      if (now - measuredAt > 1000 && intervals.length) {
        const sorted = [...intervals].sort((a, b) => a - b);
        element.dataset.averageFps = (
          1000 /
          (intervals.reduce((sum, value) => sum + value, 0) / intervals.length)
        ).toFixed(2);
        element.dataset.p95FrameMs =
          sorted[
            Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
          ].toFixed(2);
        element.dataset.frameSamples = String(intervals.length);
        measuredAt = now;
      }
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      className="city-canvas"
      style={{ touchAction: readOnly ? "auto" : "none" }}
      tabIndex={readOnly ? -1 : 0}
      aria-label={
        label ??
        "FORGE Twin. Simulated traffic, responders, hazards and infrastructure. Drag to pan, scroll to zoom, click a resource to inspect. Press 0 to reset the view."
      }
      onPointerDown={(event) => {
        if (readOnly) return;
        event.currentTarget.focus();
        pointer.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          dragged: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = pointer.current;
        if (!drag || readOnly) return;
        const dx = event.clientX - drag.x,
          dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.dragged = true;
        if (!drag.dragged) return;
        const camera = controller.current;
        camera.overview = false;
        camera.zoom ??= projection.current.zoom;
        camera.x = projection.current.x - dx / camera.zoom;
        camera.y = projection.current.y - dy / camera.zoom;
        drag.x = event.clientX;
        drag.y = event.clientY;
      }}
      onPointerUp={(event) => {
        const drag = pointer.current;
        pointer.current = undefined;
        if (readOnly || !drag || drag.dragged) return;
        const bounds = event.currentTarget.getBoundingClientRect(),
          view = projection.current;
        const x =
            (event.clientX - bounds.left - bounds.width / 2) / view.zoom +
            view.x,
          y =
            (event.clientY - bounds.top - bounds.height / 2) / view.zoom +
            view.y;
        const resource =
          city.buildings.find(
            (building) =>
              x >= building.x &&
              x <= building.x + building.w &&
              y >= building.y &&
              y <= building.y + building.h,
          ) ??
          city.nodes.find(
            (node) => Math.hypot(node.x - x, node.y - y) < 30 / view.zoom,
          );
        if (resource) props.onSelect(resource.id);
      }}
      onPointerCancel={() => {
        pointer.current = undefined;
      }}
    />
  );
}
