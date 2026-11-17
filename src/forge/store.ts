import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyState, stateSchema, type State } from "./records";

export interface StateStore {
  read(): Promise<State>;
  transaction<T>(fn: (state: State) => Promise<T> | T): Promise<T>;
}
export class LocalStateStore implements StateStore {
  private queue: Promise<unknown> = Promise.resolve();
  private file: string;
  private cached?: { signature: string; state: State };
  constructor(directory = process.env.FORGE_DATA_DIR ?? "./data") {
    this.file = resolve(directory, "forge.json");
  }
  async read(): Promise<State> {
    const pending = this.queue.then(() => this.readFileState());
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  private async readFileState(): Promise<State> {
    try {
      const signature = await this.fileSignature();
      if (this.cached?.signature === signature)
        return structuredClone(this.cached.state);
      const state = stateSchema.parse(
        JSON.parse(await readFile(this.file, "utf8")),
      );
      this.cached = { signature, state };
      return structuredClone(state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = undefined;
        return emptyState();
      }
      throw error;
    }
  }
  private async fileSignature() {
    const metadata = await stat(this.file, { bigint: true });
    return [
      metadata.ino,
      metadata.size,
      metadata.mtimeNs,
      metadata.ctimeNs,
    ].join("|");
  }
  transaction<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
    const pending = this.queue.then(async () => {
      const state = await this.readFileState();
      const result = await fn(state);
      const validated = stateSchema.parse(state);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(validated), {
        mode: 0o600,
      });
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(temporary, this.file);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (
            attempt >= 4 ||
            !["EPERM", "EBUSY", "EACCES"].includes(code ?? "")
          )
            throw error;
          await new Promise((done) => setTimeout(done, 25 * 2 ** attempt));
        }
      }
      this.cached = {
        signature: await this.fileSignature(),
        state: validated,
      };
      return result;
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
}
export class MemoryStateStore implements StateStore {
  private state = emptyState();
  private queue: Promise<unknown> = Promise.resolve();
  async read() {
    return structuredClone(this.state);
  }
  transaction<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
    const p = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await fn(draft);
      this.state = stateSchema.parse(draft);
      return result;
    });
    this.queue = p.catch(() => undefined);
    return p;
  }
}
