"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "./primitives";

export type Status = {
  mode: "local" | "showcase";
  model: { state: "live"; model: string; url: string } | { state: "scripted" } | { state: "offline"; reason: string };
  egress: { loopback: number; blocked: number; external: number };
  tools: number;
};

export function useStatus(initialMode: "local" | "showcase") {
  const [status, setStatus] = useState<Status | undefined>(initialMode === "showcase" ? { mode: "showcase", model: { state: "offline", reason: "Showcase mode plays recorded builds." }, egress: { loopback: 0, blocked: 0, external: 0 }, tools: 0 } : undefined);
  useEffect(() => {
    if (initialMode === "showcase") return;
    let alive = true;
    const load = () =>
      fetch("/api/status")
        .then((r) => r.json())
        .then((s) => alive && setStatus(s))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [initialMode]);
  return status;
}

const NAV = [
  { href: "/", label: "Forge" },
  { href: "/tools", label: "Toolbox" },
  { href: "/assistants", label: "Assistants" },
  { href: "/safety", label: "Safety Lab" },
  { href: "/scorecard", label: "Scorecard" },
  { href: "/activity", label: "Activity" },
];

export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="mk" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff6a1f" />
          <stop offset="1" stopColor="#ffd38a" />
        </linearGradient>
      </defs>
      <path d="M6 23h20l-3 5H9z" fill="#2b3641" />
      <path d="M5 13h22v4c0 3-2 6-6 6H11c-4 0-6-3-6-6z" fill="#8ea2b2" />
      <path d="M16 3c3 3 4 5 2 8 3-1 4-3 4-5 3 3 2 6 0 7H10c-2-2-2-5 1-7 0 2 1 3 3 4-2-3-1-5 2-7z" fill="url(#mk)" />
    </svg>
  );
}

export function Shell({ children, mode }: { children: React.ReactNode; mode: "local" | "showcase" }) {
  const status = useStatus(mode);
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ash focus:px-3 focus:py-2">
        Skip to content
      </a>
      {status?.mode === "showcase" || status?.model.state === "offline" ? (
        <div className="border-b border-line bg-iron/80 px-4 py-2 text-center text-[13px] text-dim">
          {status?.mode === "showcase" ? (
            <>
              <span className="font-semibold text-steel-hi">Showcase.</span> Builds here are recordings of real runs; tools you try run in your browser and your files never leave it.{" "}
              <Link href="/settings" className="text-amber underline-offset-4 hover:underline">
                Run FORGE locally
              </Link>{" "}
              to forge live.
            </>
          ) : (
            <>
              <span className="font-semibold text-steel-hi">No local model found.</span> Recorded builds and installed tools still work.{" "}
              <Link href="/settings" className="text-amber underline-offset-4 hover:underline">
                How to turn on live generation
              </Link>
            </>
          )}
        </div>
      ) : null}
      <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1320px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-display text-[19px] font-bold tracking-tight">
            <Mark className="size-7" />
            FORGE
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => {
              const on = n.href === "/" ? path === "/" || path.startsWith("/forge") : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className={cx("rounded-md px-3 py-1.5 text-[14px] transition-colors", on ? "bg-iron text-paper" : "text-dim hover:text-paper")}>
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <StatusPill status={status} />
            <button className="rounded-md p-2 text-dim hover:bg-iron md:hidden" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        {menu && (
          <nav className="border-t border-line px-4 py-2 md:hidden" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMenu(false)} className="block rounded-md px-3 py-2.5 text-paper hover:bg-iron">
                {n.label}
              </Link>
            ))}
            <Link href="/settings" onClick={() => setMenu(false)} className="block rounded-md px-3 py-2.5 text-paper hover:bg-iron">
              Settings
            </Link>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-5 text-[13px] text-faint sm:px-6">
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 rounded-full bg-steel" />
            <span className="num text-steel-hi">{status ? status.egress.external : 0}</span> requests left this machine
            {status && status.egress.blocked > 0 && <span className="text-dim">· {status.egress.blocked} blocked</span>}
          </span>
          <span>Free and local. No account, no telemetry.</span>
          <Link href="/settings" className="ml-auto hover:text-paper">
            Settings
          </Link>
        </div>
      </footer>
    </div>
  );
}

function StatusPill({ status }: { status?: Status }) {
  if (!status) return <span className="h-7 w-28 animate-pulse rounded-full bg-iron" aria-hidden />;
  const m = status.model;
  if (status.mode === "showcase")
    return <Link href="/settings" className="rounded-full border border-steel/40 bg-steel-deep/30 px-3 py-1 text-[12px] font-medium text-steel-hi">Showcase</Link>;
  if (m.state === "live")
    return (
      <Link href="/settings" className="flex items-center gap-2 rounded-full border border-molten/40 bg-molten/10 px-3 py-1 text-[12px] font-medium text-amber" title={`Local model at ${m.url}`}>
        <span aria-hidden className="size-1.5 rounded-full bg-molten ember" />
        <span className="hidden sm:inline">{m.model}</span>
        <span className="sm:hidden">Live</span>
      </Link>
    );
  if (m.state === "scripted") return <span className="rounded-full border border-line-strong px-3 py-1 text-[12px] text-dim">Scripted model</span>;
  return (
    <Link href="/settings" className="rounded-full border border-line-strong px-3 py-1 text-[12px] text-dim">
      No model
    </Link>
  );
}
