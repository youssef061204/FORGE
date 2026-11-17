import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";

export class SecretVault {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory = process.env.FORGE_DATA_DIR ?? "./data") {}
  private async key() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const name = resolve(this.directory, "vault.key");
    if (process.env.FORGE_VAULT_KEY) {
      if (!/^[a-f0-9]{64}$/i.test(process.env.FORGE_VAULT_KEY))
        throw new Error("FORGE_VAULT_KEY must be 32-byte hex");
      return Buffer.from(process.env.FORGE_VAULT_KEY, "hex");
    }
    try {
      return await readFile(name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const key = randomBytes(32);
    try {
      await writeFile(name, key, { mode: 0o600, flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      return readFile(name);
    }
    return key;
  }
  private async load(): Promise<Record<string, unknown>> {
    const key = await this.key();
    try {
      const bytes = await readFile(join(this.directory, "secrets.enc"));
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString("utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("Encrypted connector storage could not be opened");
    }
  }
  async get(name: string): Promise<unknown> {
    await this.queue;
    return (await this.load())[name];
  }
  set(name: string, value: unknown) {
    const task = this.queue.then(async () => {
      const values = await this.load();
      if (value === undefined) delete values[name];
      else values[name] = value;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", await this.key(), iv);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(values), "utf8"),
        cipher.final(),
      ]);
      const file = join(this.directory, "secrets.enc");
      const temp = `${file}.tmp`;
      await writeFile(
        temp,
        Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
        { mode: 0o600 },
      );
      await rename(temp, file);
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
