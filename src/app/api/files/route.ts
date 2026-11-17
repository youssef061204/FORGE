import { z } from "zod";
import { formatFromName, sniffFormat } from "@/core/codec";
import { forge } from "@/server/forge";
import { body, handle, json } from "@/server/http";

const upload = z.object({
  name: z.string().min(1).max(120).regex(/^[^/\\:*?"<>|]+$/),
  text: z.string().max(10 * 1024 * 1024),
  format: z.enum(["csv", "tsv", "json", "text"]).optional(),
});

export async function GET(req: Request) {
  return handle(req, () => json({ files: forge().repo.files() }));
}

export async function POST(req: Request) {
  return handle(
    req,
    async () => {
      const b = await body(req, upload);
      const file = forge().repo.addFile(b.name, b.format ?? formatFromName(b.name) ?? sniffFormat(b.text), b.text);
      return json({ file: { id: file.id, name: file.name, format: file.format, bytes: file.bytes, sha256: file.sha256 } });
    },
    { mutate: true },
  );
}
