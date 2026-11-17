"use client";
import Link from "next/link";
import type { Tape } from "@/core/events/types";
import { useTape } from "./build-source";
import { ForgeFloor } from "./floor/floor";
import { Button } from "./primitives";

/** A benchmark mission's recorded build, on the same Forge Floor as a live one. */
export function TapeFloor({ tape }: { tape: Tape }) {
  const player = useTape(tape, { speed: 4 });
  return (
    <>
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-2 px-4 pt-6 sm:px-6">
        <Link href="/scorecard" className="mr-4 text-[13px] text-dim hover:text-paper">
          ← Scorecard
        </Link>
        <Button size="sm" tone="ghost" onClick={() => player.seek()} disabled={player.done}>
          Skip to end
        </Button>
      </div>
      <ForgeFloor view={player.view} events={player.events} readOnly />
    </>
  );
}
