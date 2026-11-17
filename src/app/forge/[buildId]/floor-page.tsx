"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Example, Tape } from "@/core/events/types";
import { loadTape, useLiveBuild, useTape } from "@/ui/build-source";
import { ForgeFloor } from "@/ui/floor/floor";
import { Button } from "@/ui/primitives";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

function Live({ id }: { id: string }) {
  const router = useRouter();
  const { view, events } = useLiveBuild(id);
  const [error, setError] = useState<string>();
  const [fileIds, setFileIds] = useState<string[]>([]);
  useEffect(() => {
    fetch(`/api/builds/${id}`)
      .then((r) => r.json())
      .then((d) => setFileIds(d.build?.fileIds ?? []))
      .catch(() => undefined);
  }, [id]);
  const rebuild = async (extra: { drafts?: number; examples?: Example[] }) => {
    try {
      const { id: next } = await post("/api/builds", { request: view.request, fileIds, ...extra, examples: [...view.examples, ...(extra.examples ?? [])] });
      router.push(`/forge/${next}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      {error && (
        <p role="alert" className="mx-auto mt-4 max-w-[1320px] px-6 text-[#f1a99b]">
          {error}
        </p>
      )}
      <ForgeFloor
        view={view}
        events={events}
        actions={{
          answer: (cluster) => post(`/api/builds/${id}/answer`, { cluster }).catch((e) => setError(e.message)),
          approve: () => view.review && post(`/api/builds/${id}/approve`, { hash: view.review.hash }).catch((e) => setError(e.message)),
          fix: (example) => rebuild({ examples: [example] }),
          retry: (drafts) => rebuild({ drafts }),
          simplify: () => router.push(`/?request=${encodeURIComponent(view.request)}`),
        }}
      />
    </>
  );
}

function Recorded({ name, showcase }: { name: string; showcase: boolean }) {
  const [tape, setTape] = useState<Tape>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    loadTape(name).then(setTape, (e) => setError(e.message));
  }, [name]);
  const player = useTape(tape, { speed: 1 });
  if (error) return <p className="mx-auto max-w-[1320px] p-6 text-[#f1a99b]">{error}</p>;
  return (
    <>
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-2 px-4 pt-6 sm:px-6">
        <Button size="sm" onClick={() => player.setPlaying(!player.playing)} disabled={player.done}>
          {player.playing ? "Pause" : "Play"}
        </Button>
        {[1, 2, 4].map((s) => (
          <Button key={s} size="sm" tone={player.speed === s ? "steel" : "ghost"} onClick={() => player.setSpeed(s)}>
            {s}×
          </Button>
        ))}
        <Button size="sm" tone="ghost" onClick={() => player.seek()} disabled={player.done}>
          Skip to end
        </Button>
      </div>
      <ForgeFloor view={player.view} events={player.events} readOnly showcase={showcase} />
    </>
  );
}

export function FloorPage({ id, showcase }: { id: string; showcase: boolean }) {
  if (id.startsWith("tape-")) return <Recorded name={id.slice(5)} showcase={showcase} />;
  return <Live id={id} />;
}
