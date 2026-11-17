(async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(process.env.FORGE_DATA_DIR || "/app/data");
  const target = path.join(root, "backups", "before-local-product-2026-10-22");
  try {
    await fs.access(target);
    throw new Error("Backup already exists; refusing to overwrite it");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const entries = (await fs.readdir(root)).filter((name) => name !== "backups");
  await fs.mkdir(target, { recursive: true });
  for (const name of entries)
    await fs.cp(path.join(root, name), path.join(target, name), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  console.log(
    JSON.stringify({
      backedUp: true,
      entries: entries.length,
      privateDataRemainsInVolume: true,
    }),
  );
})().catch((error) => {
  console.error(
    error.message === "Backup already exists; refusing to overwrite it"
      ? error.message
      : "Private state backup failed; contents omitted",
  );
  process.exitCode = 1;
});
