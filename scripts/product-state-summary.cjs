(async () => {
  const fs = await import("node:fs"),
    crypto = await import("node:crypto");
  const file = (process.env.FORGE_DATA_DIR || "/app/data") + "/forge.json";
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  const sha = (value) =>
    crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  console.log(
    JSON.stringify({
      installed: state.releases
        .filter((release) => release.status === "installed")
        .map((release) => ({
          id: release.definition.id,
          version: release.definition.version,
          digest: release.digest,
        })),
      worldHash: sha(state.world),
      productPrograms: state.product?.programs.length ?? 0,
      calendarConfigured: Boolean(process.env.GOOGLE_CALENDAR_ID),
      calendarIsPrimary: process.env.GOOGLE_CALENDAR_ID === "primary",
      tokenConfigured: Boolean(process.env.FORGE_API_TOKEN),
    }),
  );
})().catch(() => {
  console.error("State summary failed; private state omitted");
  process.exitCode = 1;
});
