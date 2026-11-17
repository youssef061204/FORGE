"""Preserve a local running FORGE filesystem without Docker environment metadata.

docker export excludes mounted volumes. Validate the exported archive before
importing, and reconstruct only an explicit nonsecret runtime configuration.
This script never stops or changes the source container.
"""

import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "next-rollback-2026-10-23"
ARCHIVE = OUT / "forge-before-overhaul.tar"
TAG = "forge-app:rollback-pre-overhaul-2026-10-23"
SOURCE = "forge-forge-1"
EXPECTED_SOURCE_IMAGE = "sha256:102df1f1d22e3cd75bde13629467e9857dbd030784a71edf69ab957f815d7bdb"
ENVIRONMENT = [
    "NODE_ENV=production",
    "HOSTNAME=0.0.0.0",
    "FORGE_DATA_DIR=/app/data",
]


def docker(*args):
    result = subprocess.run(
        ["docker", "--context", "desktop-linux", *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


source_image = docker("container", "inspect", SOURCE, "--format", "{{.Image}}")
if source_image != EXPECTED_SOURCE_IMAGE:
    raise RuntimeError("The source container no longer has the expected old image")
mounts = json.loads(
    docker("container", "inspect", SOURCE, "--format", "{{json .Mounts}}")
)
if not any(m["Type"] == "volume" and m["Destination"] == "/app/data" for m in mounts):
    raise RuntimeError("The private data directory must be a mounted named volume")
OUT.mkdir(parents=True, exist_ok=True)
if ARCHIVE.exists():
    raise RuntimeError("The rollback archive already exists; refusing to overwrite it")
print("Exporting old local container; mounted data is excluded", flush=True)
docker("container", "export", "--output", str(ARCHIVE), SOURCE)

data_files = 0
secret_files = 0
with tarfile.open(ARCHIVE, "r|") as archive:
    for item in archive:
        path = item.name.removeprefix("./").lstrip("/")
        if path.startswith("app/data/") and not item.isdir():
            data_files += 1
        if path.startswith("app/") and (
            Path(path).name.startswith(".env")
            or Path(path).name in {"vault.key", "secrets.enc"}
        ):
            secret_files += 1
if data_files or secret_files:
    raise RuntimeError("Private application files were found; rollback import blocked")

changes = [f"ENV {value}" for value in ENVIRONMENT] + [
    "WORKDIR /app",
    "USER node",
    'CMD ["node","server.js"]',
    "EXPOSE 3000",
]
arguments = ["image", "import"]
for change in changes:
    arguments.extend(["--change", change])
arguments.extend([str(ARCHIVE), TAG])
image_id = docker(*arguments)
config = json.loads(
    docker("image", "inspect", TAG, "--format", "{{json .Config}}")
)
if (
    sorted(config.get("Env") or []) != sorted(ENVIRONMENT)
    or config.get("Cmd") != ["node", "server.js"]
    or config.get("WorkingDir") != "/app"
    or config.get("User") != "node"
    or "3000/tcp" not in config.get("ExposedPorts", {})
):
    raise RuntimeError("Rollback image runtime metadata did not match the allowlist")

probe = r"""
const fs = require('node:fs');
const paths = ['server.js', 'sandbox/worker.mjs', 'sandbox/module-worker.mjs'];
for (const path of paths) fs.accessSync(path);
const typescript = require.resolve('typescript');
fs.accessSync(require.resolve('typescript/lib/lib.es2022.d.ts'));
const dataEntries = fs.existsSync('/app/data') ? fs.readdirSync('/app/data') : [];
if (dataEntries.length) throw new Error('Rollback contains application data');
for (const path of ['.env', '.env.google', '.env.gpu', 'data/vault.key', 'data/secrets.enc']) {
  if (fs.existsSync(path)) throw new Error('Rollback contains a private application file');
}
process.stdout.write(JSON.stringify({files: paths, typescript, dataDirectoryEntries: dataEntries.length, network: 'none', stateVolumeMounted: false}));
"""
probe_result = json.loads(
    docker(
        "container", "run", "--rm", "--pull", "never", "--network", "none",
        "--entrypoint", "node", TAG, "-e", probe,
    )
)
checksum = hashlib.sha256()
with ARCHIVE.open("rb") as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        checksum.update(chunk)
report = {
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "tag": TAG,
    "imageId": image_id,
    "sourceImageId": source_image,
    "archive": ARCHIVE.relative_to(ROOT).as_posix(),
    "archiveBytes": ARCHIVE.stat().st_size,
    "archiveSha256": checksum.hexdigest(),
    "exportedDataVolumeFiles": data_files,
    "exportedPrivateApplicationFiles": secret_files,
    "restoredMetadata": changes,
    "probe": probe_result,
    "sourceContainerStoppedOrChanged": False,
    "method": "docker export/import; container environment metadata and mounted volumes are not exported",
}
(OUT / "verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
