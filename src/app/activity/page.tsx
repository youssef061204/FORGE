import Link from "next/link";
import { forge, isShowcase } from "@/server/forge";
import { EmptyState, Eyebrow, Panel } from "@/ui/primitives";

export const metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { write: "wrote", deny: "refused", approve: "approved", revoke: "revoked", view: "showed", install: "installed" };

export default function Activity() {
  if (isShowcase())
    return (
      <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6">
        <h1 className="font-display text-4xl font-semibold">Activity</h1>
        <div className="mt-6">
          <EmptyState title="Nothing here in the showcase">On your own FORGE, every write, refusal, approval and revocation leaves a receipt on this timeline.</EmptyState>
        </div>
      </div>
    );
  const { repo } = forge();
  const receipts = repo.receipts(undefined, 200);
  const builds = repo.builds(15);
  const tools = new Map(repo.tools().map((t) => [t.id, t.name]));
  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.6fr_1fr]">
      <div>
        <h1 className="font-display text-4xl font-semibold">Activity</h1>
        <p className="mt-2 text-dim">Every effect leaves a receipt: writes, refusals, approvals and revocations.</p>
        {receipts.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="No receipts yet">Run a tool and its writes appear here.</EmptyState>
          </div>
        ) : (
          <ol className="mt-6 border-l border-line">
            {receipts.map((r) => (
              <li key={r.id} className="relative pb-4 pl-5">
                <span aria-hidden className={`absolute -left-[5px] top-1.5 size-2.5 rounded-full ${r.status === "denied" ? "bg-slag" : r.kind === "approve" ? "bg-brass" : r.kind === "revoke" ? "bg-slag" : "bg-steel"}`} />
                <div className="text-[14px]">
                  <Link href={`/tools/${r.toolId}`} className="font-medium hover:underline">
                    {tools.get(r.toolId) ?? r.toolId}
                  </Link>{" "}
                  <span className={r.status === "denied" ? "text-[#f1a99b]" : "text-dim"}>{r.status === "deduplicated" ? "skipped a duplicate of" : (KIND[r.kind] ?? r.kind)}</span> <span className="font-mono text-[13px]">{r.target}</span>
                </div>
                <div className="text-[12px] text-faint">
                  {new Date(r.at).toLocaleString()} · v{r.version} · {r.detail}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <Panel className="h-fit p-5">
        <Eyebrow>Recent builds</Eyebrow>
        <ul className="mt-3 space-y-2">
          {builds.map((b) => (
            <li key={b.id}>
              <Link href={`/forge/${b.id}`} className="block rounded-lg px-2 py-1.5 hover:bg-iron">
                <span className="line-clamp-1 text-[14px]">{b.request}</span>
                <span className="text-[12px] text-faint">
                  {b.outcome ?? b.status} · {b.model} · {new Date(b.createdAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
