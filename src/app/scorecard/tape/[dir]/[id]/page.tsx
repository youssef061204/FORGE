import { notFound } from "next/navigation";
import type { Tape } from "@/core/events/types";
import { tape } from "@/server/results";
import { TapeFloor } from "@/ui/tape-floor";

export default async function Page(props: PageProps<"/scorecard/tape/[dir]/[id]">) {
  const { dir, id } = await props.params;
  const t = tape(dir, id) as Tape | undefined;
  if (!t) notFound();
  return <TapeFloor tape={t} />;
}
