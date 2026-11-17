// Explicit metadata allowlist. Never log goals, payloads, resumes, credentials,
// raw model output, or arbitrary exception messages to application stdout.
export function logRequest(metadata: {
  transport: "mcp" | "owner-api";
  method: string;
  status: number;
  durationMs: number;
}) {
  if (process.env.NODE_ENV !== "test")
    console.info(
      JSON.stringify({
        event: "forge.request.completed",
        at: new Date().toISOString(),
        ...metadata,
      }),
    );
}
