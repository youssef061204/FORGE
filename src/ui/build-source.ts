"use client";
/**
 * One hook, two sources. A live build streams over SSE; a tape replays its
 * recorded events on their original timeline (optionally faster). Both feed
 * the same pure reducer, so the Forge Floor cannot tell them apart, and the
 * provenance label always says which one it is.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { emptyBuild, reduce, type BuildView } from "@/core/events/reducer";
import type { BuildEvent, Tape } from "@/core/events/types";

type State = { view: BuildView; events: BuildEvent[] };
const init = (id: string): State => ({ view: emptyBuild(id), events: [] });
function step(s: State, e: BuildEvent | "reset"): State {
  if (e === "reset") return init(s.view.id);
  if (e.seq <= s.view.lastSeq) return s;
  return { view: reduce(s.view, e), events: [...s.events, e] };
}

export function useLiveBuild(id: string | undefined) {
  const [state, dispatch] = useReducer(step, init(id ?? ""));
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!id) return;
    const source = new EventSource(`/api/builds/${id}/events`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));
    source.addEventListener("build", (m) => dispatch(JSON.parse((m as MessageEvent).data) as BuildEvent));
    return () => source.close();
  }, [id]);
  return { ...state, connected };
}

export function useTape(tape: Tape | undefined, opts: { speed?: number; autoplay?: boolean } = {}) {
  const [state, dispatch] = useReducer(step, init(tape?.id ?? ""));
  const [playing, setPlaying] = useState(opts.autoplay ?? true);
  const [speed, setSpeed] = useState(opts.speed ?? 1);
  const cursor = useRef(0);
  const clock = useRef(0);
  const [done, setDone] = useState(false);
  // Callers remount this hook (key={tape.id}) to play a different tape.
  useEffect(() => {
    if (!tape || !playing) return;
    let last = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      clock.current += (t - last) * speed;
      last = t;
      const events = tape.events;
      while (cursor.current < events.length && events[cursor.current].atMs <= clock.current) dispatch(events[cursor.current++]);
      if (cursor.current >= events.length) {
        setDone(true);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tape, playing, speed]);
  /** Jump to the first event of a type (or the end). */
  const seek = (until?: BuildEvent["t"]) => {
    if (!tape) return;
    while (cursor.current < tape.events.length) {
      const e = tape.events[cursor.current++];
      dispatch(e);
      clock.current = e.atMs;
      if (until && e.t === until) return;
    }
    setDone(true);
  };
  /** Play up to (and including) the first event of a type, then pause. */
  const runTo = (until: BuildEvent["t"]) => seek(until);
  return { ...state, playing, setPlaying, speed, setSpeed, seek, runTo, done };
}

export async function loadTape(name: string): Promise<Tape> {
  const res = await fetch(`/tapes/${name}.json`);
  if (!res.ok) throw new Error(`No tape named ${name}`);
  return (await res.json()) as Tape;
}
