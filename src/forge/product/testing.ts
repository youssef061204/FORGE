// Explicit development-only response injection. No goal keywords are examined.
// These recorded responses exercise the real compiler, sandbox and broker.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { RecordedMissionModel } from "./provider";
import {
  solutionSchema,
  type FabricConnector,
  type CallContext,
} from "./contracts";
import { objectSchema } from "./schemas";
export async function loadRecordedModel(path: string) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Recorded compiler injection is forbidden in production");
  const bytes = await readFile(path, "utf8");
  if (Buffer.byteLength(bytes) > 1000000)
    throw new Error("Recorded responses exceed the test budget");
  const responses = z
    .array(solutionSchema)
    .min(1)
    .max(100)
    .parse(JSON.parse(bytes));
  let index = 0;
  return new RecordedMissionModel(() => {
    const response = responses[index++];
    if (!response)
      throw new Error(
        "Recorded test responses exhausted; no fixture substitution was made",
      );
    return response;
  });
}
export class DevelopmentTasksConnector implements FabricConnector {
  private due = "2026-10-19";
  private handled = new Set<string>();
  async describe() {
    return {
      id: "testtasks",
      name: "Controlled test tasks",
      kind: "builtin" as const,
      status: "connected" as const,
      mode: "test" as const,
      binding: "development-test-owner",
      setup: "",
      constraints: { testOnly: true, realService: false },
      operations: [
        {
          id: "testtasks.list",
          connector: "testtasks",
          name: "Read controlled tasks",
          description: "Read the isolated development test task",
          inputSchema: objectSchema(),
          outputSchema: objectSchema(
            {
              tasks: {
                type: "array",
                items: objectSchema(
                  {
                    id: { type: "string", enum: ["task-a"] },
                    title: { type: "string" },
                    due: { type: "string" },
                    urgent: { type: "boolean" },
                  },
                  ["id", "title", "due", "urgent"],
                ),
              },
            },
            ["tasks"],
          ),
          permission: "testtasks.read",
          kind: "read" as const,
          sideEffect: "none" as const,
          idempotent: true,
        },
        {
          id: "testtasks.move",
          connector: "testtasks",
          name: "Move controlled deadline",
          description: "Move only the isolated development test task",
          inputSchema: objectSchema(
            {
              id: { type: "string", enum: ["task-a"] },
              due: { type: "string" },
            },
            ["id", "due"],
          ),
          outputSchema: objectSchema({ id: { type: "string" } }, ["id"]),
          permission: "testtasks.move.write",
          kind: "write" as const,
          sideEffect: "reversible" as const,
          idempotent: true,
        },
      ],
    };
  }
  async invoke(
    id: string,
    args: Record<string, unknown>,
    context: CallContext,
  ) {
    if (id === "testtasks.list")
      return {
        data: {
          tasks: [
            {
              id: "task-a",
              title: "Controlled course deadline",
              due: this.due,
              urgent: true,
            },
          ],
        },
      };
    if (context.mode !== "live") throw new Error("Replay write denied");
    if (!this.handled.has(context.key)) {
      this.due = String(args.due);
      this.handled.add(context.key);
    }
    return {
      data: { id: "task-a" },
      target: "Isolated test task",
      responseId: context.key,
    };
  }
}
