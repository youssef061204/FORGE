"use client";
import { useState } from "react";
export function GpuInspection({ token }: { token: string }) {
  const [batch, setBatch] = useState(1000),
    [result, setResult] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const response = await fetch("/api/gpu", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify({ batch }),
      });
      const value = await response.json();
      setResult(value);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <p>Run actual CUDA hazard-field futures from current observations</p>
      <select
        aria-label="GPU simulation count"
        value={batch}
        onChange={(e) => setBatch(Number(e.target.value))}
      >
        {[100, 1000, 2048].map((n) => (
          <option key={n} value={n}>
            {n} field futures
          </option>
        ))}
      </select>
      <button
        className="surface-button"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? "Computing…" : "Run GPU fields"}
      </button>
      {result !== undefined && (
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      <p>
        Read-only field simulations. Fixed centers, radii and weather;
        uncertainty perturbs hazard intensity. The result cannot approve a
        program or establish physical safety.
      </p>
    </div>
  );
}
