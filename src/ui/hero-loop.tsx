"use client";
/**
 * Ambient hero: five drafts glow, get tested, four cool to steel and merge,
 * one falls away, a seal lands. Pure SVG + CSS; static under reduced motion.
 */
import { useEffect, useState } from "react";

const LANES = [0, 1, 2, 3, 4];
const WRONG = 2;

export function HeroLoop() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const f = requestAnimationFrame(() => setPhase(4));
      return () => cancelAnimationFrame(f);
    }
    const t = setInterval(() => setPhase((p) => (p + 1) % 6), 1400);
    return () => clearInterval(t);
  }, []);
  // 0 writing, 1 testing, 2 one fails, 3 four merge, 4 sealed, 5 rest
  return (
    <svg viewBox="0 0 420 300" className="h-auto w-full max-w-[520px]" role="img" aria-label="Five drafts are written and tested; four agree, one is discarded, and the winner is sealed.">
      <defs>
        <linearGradient id="hl-molten" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff6a1f" />
          <stop offset="1" stopColor="#ffd38a" />
        </linearGradient>
        <radialGradient id="hl-glow">
          <stop offset="0" stopColor="#ff6a1f" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ff6a1f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="210" cy="150" r="150" fill="url(#hl-glow)" opacity={phase < 3 ? 0.9 : 0.35} style={{ transition: "opacity 1.2s" }} />
      {LANES.map((i) => {
        const failed = i === WRONG && phase >= 2;
        const merged = phase >= 3 && !failed;
        const y = merged ? 150 - 18 + (i > WRONG ? i - 1 : i) * 9 : 38 + i * 50;
        const x = merged ? 150 : 40;
        const w = merged ? 120 : phase === 0 ? 80 + i * 24 : 240;
        const color = failed ? "#c0523f" : phase >= 3 ? "#8ea2b2" : "url(#hl-molten)";
        return (
          <g key={i} style={{ transition: "transform 1.1s cubic-bezier(.2,.8,.2,1), opacity 1s", transform: `translate(${failed ? x + 60 : x}px, ${y}px)`, opacity: failed ? 0 : 1 }}>
            <rect width="340" height="30" rx="8" fill="#14110f" stroke="rgba(255,236,210,.09)" opacity={merged ? 0 : 1} style={{ transition: "opacity .8s" }} />
            <rect x="12" y="11" height="8" rx="4" width={w} fill={color} style={{ transition: "width 1.2s cubic-bezier(.2,.8,.2,1), fill .8s" }} />
            {phase === 1 && !merged && <circle cx={w + 22} cy="15" r="4" fill="#ffb04a" className="ember" />}
          </g>
        );
      })}
      <g style={{ transition: "transform .6s cubic-bezier(.2,.8,.2,1), opacity .4s", transform: `translate(310px, 150px) scale(${phase >= 4 ? 1 : 0.4})`, opacity: phase >= 4 ? 1 : 0 }}>
        <circle r="34" fill="#2b3641" stroke="#caa24c" strokeWidth="3" />
        <path d="M-12 0 l8 8 l16 -18" stroke="#f0d48c" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x="40" y="292" fontSize="12" fill="#766b60" fontFamily="var(--font-mono)">
        {["writing 5 drafts", "testing on your data", "one disagrees", "4 of 5 agree", "approved · sealed", "approved · sealed"][phase]}
      </text>
    </svg>
  );
}
