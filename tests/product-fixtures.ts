import { z } from "zod";
import type {
  FabricConnector,
  CallContext,
  ProgramDraft,
  Solution,
  ConnectorResult,
} from "../src/forge/product/contracts";
import { objectSchema } from "../src/forge/product/schemas";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { LocalNotificationConnector } from "../src/forge/product/builtin";
import { RecordedMissionModel } from "../src/forge/product/provider";
import { ProductRuntime } from "../src/forge/product/runtime";
import { MemoryStateStore, type StateStore } from "../src/forge/store";
export const now = "2026-10-10T15:00:00.000Z";
export class TestTasksConnector implements FabricConnector {
  tasks = [
    { id: "task-a", title: "CISC 221", due: "2026-10-19", urgent: true },
  ];
  writes: { key: string; id: string; due: string }[] = [];
  binding = "test-owner-1";
  fail?: Error;
  async describe() {
    return {
      id: "tasks",
      name: "Test tasks",
      kind: "builtin" as const,
      status: "connected" as const,
      mode: "test" as const,
      binding: this.binding,
      setup: "",
      constraints: { testOnly: true },
      operations: [
        {
          id: "tasks.list",
          connector: "tasks",
          name: "Read tasks",
          description: "Read controlled test tasks",
          inputSchema: objectSchema(),
          outputSchema: objectSchema(
            {
              tasks: {
                type: "array",
                maxItems: 100,
                items: objectSchema(
                  {
                    id: { type: "string" },
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
          permission: "tasks.read",
          kind: "read" as const,
          sideEffect: "none" as const,
          idempotent: true,
        },
        {
          id: "tasks.move",
          connector: "tasks",
          name: "Move deadline",
          description: "Change a controlled test task",
          inputSchema: objectSchema(
            { id: { type: "string" }, due: { type: "string" } },
            ["id", "due"],
          ),
          outputSchema: objectSchema({ id: { type: "string" } }, ["id"]),
          permission: "tasks.move.write",
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
  ): Promise<ConnectorResult> {
    if (id === "tasks.list") return { data: { tasks: this.tasks } };
    if (context.mode !== "live") throw new Error("Replay write denied");
    if (this.fail) throw this.fail;
    const item = this.tasks.find((t) => t.id === args.id);
    if (!item) throw new Error("Unknown controlled task");
    if (!this.writes.some((w) => w.key === context.key)) {
      item.due = String(args.due);
      this.writes.push({ key: context.key, id: item.id, due: item.due });
    }
    return {
      data: { id: item.id },
      responseId: context.key,
      target: "Controlled test task",
    };
  }
}
export function draft(target = "2026-10-20"): ProgramDraft {
  return {
    name: "Deadline watcher",
    description: "Keep urgent task deadlines aligned with the requested date.",
    source: `function execute(input: ModuleInput): ModuleOutput {
    const operations: ModuleOutput["operations"] = [];
    for (const task of input.observations.tasks.tasks) {
      if (task.urgent && task.due !== ${JSON.stringify(target)}) {
        operations.push({operation:"tasks.move",arguments:{id:task.id,due:${JSON.stringify(target)}}});
      }
    }
    return {operations,result:{summary:operations.length ? "Deadline changes proposed" : "No changes needed"},state:{}};
  }`,
    reads: [{ operation: "tasks.list", arguments: {}, ref: "tasks" }],
    actions: ["tasks.move"],
    trigger: { kind: "manual" },
    tests: [
      {
        name: "Urgent deadline changes",
        input: {
          now,
          input: {},
          state: {},
          observations: {
            tasks: {
              tasks: [
                {
                  id: "held-a",
                  title: "Course A",
                  due: "2026-10-18",
                  urgent: true,
                },
              ],
            },
          },
        },
        expectedOperations: ["tasks.move"],
      },
      {
        name: "Irrelevant task stays unchanged",
        input: {
          now,
          input: {},
          state: {},
          observations: {
            tasks: {
              tasks: [
                {
                  id: "held-b",
                  title: "Course B",
                  due: "2026-10-17",
                  urgent: false,
                },
              ],
            },
          },
        },
        expectedOperations: [],
      },
    ],
  };
}
export const synthesis = (program = draft()): Solution => ({
  route: "SYNTHESIZE",
  explanation: "Build a deadline watcher from the available task operations",
  existingIds: [],
  missingConnections: [],
  program,
});
export function harness(
  resolve: (
    context: Parameters<RecordedMissionModel["plan"]>[0],
  ) => Solution | Promise<Solution> = () => synthesis(),
  store: StateStore = new MemoryStateStore(),
) {
  const tasks = new TestTasksConnector();
  const fabric = new ConnectorFabric();
  fabric.register("tasks", tasks);
  fabric.register("notifications", new LocalNotificationConnector());
  const model = new RecordedMissionModel(resolve);
  const runtime = new ProductRuntime(store, fabric, model);
  return { tasks, fabric, model, runtime, store };
}
export const eventSchema = z.object({ id: z.string(), due: z.string() });
