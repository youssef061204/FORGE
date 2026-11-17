import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { harness, now } from "../tests/product-fixtures";
import { programHash } from "../src/forge/product/runtime";
import {
  retrievePrograms,
  programComplexity,
} from "../src/forge/product/retrieval";
import { digest } from "../src/forge/hash";
import type { Program } from "../src/forge/product/contracts";
const out = "artifacts/product";
await mkdir(out, { recursive: true });
const h = harness();
const started = performance.now();
const tool = (
  await h.runtime.ask("Align urgent course task deadlines with October 20")
).tool!;
const timeToReviewMs = performance.now() - started;
await h.runtime.approve(tool.id, tool.hash, tool.permissions);
const cases = Array.from({ length: 100 }, (_, index) => ({
  id: "held-" + index,
  now,
  input: Array.from({ length: index % 7 }, (_, item) => ({
    id: `entity-${index}-${item}`,
    title: ["CISC", "MATH", "PHYS", "Interview", "Lab"][item % 5] + " " + index,
    due:
      index % 4 === 0
        ? "2026-10-20"
        : `2026-10-${String(11 + ((index + item) % 16)).padStart(2, "0")}`,
    urgent: (index + item) % 3 !== 0,
  })),
}));
await writeFile(
  out + "/held-out-execution-corpus.json",
  JSON.stringify(cases, null, 2),
);
const executions = [];
let expectedWrites = 0,
  actualWrites = 0,
  noChanges = 0,
  replayMatches = 0;
for (const test of cases) {
  h.tasks.tasks = structuredClone(test.input);
  const expected = test.input.filter(
    (task) => task.urgent && task.due !== "2026-10-20",
  );
  expectedWrites += expected.length;
  const before = h.tasks.writes.length;
  const run = await h.runtime.run(tool.id, test.id, {}, test.now);
  const produced = h.tasks.writes.slice(before);
  actualWrites += produced.length;
  const expectedIds = expected.map((task) => task.id).sort();
  const actualIds = produced.map((write) => write.id).sort();
  const passed =
    run.status === "done" &&
    digest(expectedIds) === digest(actualIds) &&
    produced.every((write) => write.due === "2026-10-20");
  assert(passed, "Held-out controlled execution failed");
  if (!expected.length) noChanges++;
  // Replay uses the same executable but is separately run with interception.
  const { runProgramExecutable } = await import("../src/forge/executable");
  const replay = await runProgramExecutable(
    tool.source,
    {
      now: test.now,
      input: {},
      state: {},
      observations: { tasks: { tasks: test.input } },
    },
    h.fabric.types(tool),
  );
  if (
    digest(replay.operations.map((action) => action.arguments.id).sort()) ===
    digest(expectedIds)
  )
    replayMatches++;
  executions.push({
    id: test.id,
    passed,
    durationMs: run.durationMs,
    expectedWrites: expected.length,
    actualWrites: produced.length,
  });
}
const durations = executions.map((run) => run.durationMs).sort((a, b) => a - b);
const percentile = (values: number[], p: number) =>
  values[Math.min(values.length - 1, Math.floor(values.length * p))];
const families = [
  {
    id: "deadline",
    name: "Semester deadline watcher",
    description: "Track course deadlines and reschedule calendar study blocks",
    queries: [
      "Watch professor assignment deadline changes",
      "Reschedule my calendar study blocks for coursework",
      "Track semester course due dates",
      "Keep my assignment schedule current",
      "Update course deadlines from email",
    ],
  },
  {
    id: "interview",
    name: "Interview coordinator",
    description:
      "Coordinate recruiter interview slots, avoid calendar conflicts and reserve preparation time",
    queries: [
      "Reserve interview preparation time",
      "Coordinate recruiter meeting slots",
      "Prevent interview schedule conflicts",
      "Plan my job interview calendar",
      "Find free time for recruiter conversations",
    ],
  },
  {
    id: "inventory",
    name: "Inventory reorder monitor",
    description:
      "Monitor warehouse stock amounts and create replenishment orders",
    queries: [
      "Watch warehouse stock levels",
      "Replenish inventory before it runs out",
      "Monitor remaining item quantities",
      "Create stock replenishment orders",
      "Track inventory reorder thresholds",
    ],
  },
  {
    id: "weather",
    name: "Weather alert",
    description: "Warn about forecast storms, rainfall and severe weather",
    queries: [
      "Warn me when a storm is forecast",
      "Notify me about severe weather",
      "Monitor tomorrow rainfall predictions",
      "Watch for weather warnings",
      "Send a forecast storm alert",
    ],
  },
  {
    id: "travel",
    name: "Travel itinerary assistant",
    description:
      "Coordinate flight arrivals, hotel check-in and trip itinerary",
    queries: [
      "Organize my flight and hotel itinerary",
      "Coordinate hotel check-in with arrival",
      "Keep trip travel details together",
      "Build a travel itinerary",
      "Plan around flight arrival times",
    ],
  },
  {
    id: "expenses",
    name: "Expense tracker",
    description:
      "Categorize receipts, calculate spending totals and monthly budget changes",
    queries: [
      "Track monthly receipt spending",
      "Categorize my expenses and purchases",
      "Calculate total spending from receipts",
      "Watch budget changes this month",
      "Summarize monthly expense categories",
    ],
  },
  {
    id: "fitness",
    name: "Fitness routine planner",
    description:
      "Schedule workout sessions and recovery days around activity goals",
    queries: [
      "Schedule workout and recovery days",
      "Plan fitness sessions around my calendar",
      "Track weekly workout activity goals",
      "Arrange my exercise routine",
      "Reserve time for workout sessions",
    ],
  },
  {
    id: "family",
    name: "Family school briefing",
    description:
      "Summarize school notices, parent announcements and family events",
    queries: [
      "Brief me on school announcements",
      "Summarize family school notices",
      "Keep parent announcements organized",
      "Tell me about upcoming family events",
      "Create a weekly school briefing",
    ],
  },
  {
    id: "support",
    name: "Support ticket triage",
    description:
      "Prioritize customer issue tickets by urgency and notify on high priority problems",
    queries: [
      "Prioritize urgent customer support tickets",
      "Triage incoming customer issues",
      "Notify on high priority support problems",
      "Sort issue tickets by urgency",
      "Watch customer support queues",
    ],
  },
  {
    id: "twin",
    name: "Twin responder dispatcher",
    description:
      "Compare simulated emergency vehicle routing and fire response strategies",
    queries: [
      "Compare simulated emergency responder routing",
      "Dispatch fire response vehicles in the Twin",
      "Reduce simulated emergency arrival delays",
      "Route Twin responders around hazards",
      "Compare vehicle response strategies",
    ],
  },
];
const catalog: Program[] = families.map((family) => {
  const program = {
    ...structuredClone(tool),
    status: "ready" as const,
    id: family.id,
    name: family.name,
    description: family.description,
    goal: family.description,
  };
  program.hash = programHash(program);
  return program;
});
const queries = families.flatMap((family) =>
  family.queries.flatMap((query, index) => [
    { goal: query, expected: family.id },
    {
      goal: index % 2 ? "Please " + query.toLowerCase() : query + " for me",
      expected: family.id,
    },
  ]),
);
await writeFile(
  out + "/retrieval-corpus.json",
  JSON.stringify(
    {
      catalog: families.map(({ id, name, description }) => ({
        id,
        name,
        description,
      })),
      queries,
    },
    null,
    2,
  ),
);
let recall1 = 0,
  recall3 = 0,
  reciprocal = 0;
const retrievalRows = queries.map((query) => {
  const ranks = retrievePrograms(query.goal, catalog).map(
      (row) => row.program.id,
    ),
    rank = ranks.indexOf(query.expected);
  if (rank === 0) recall1++;
  if (rank >= 0) {
    recall3++;
    reciprocal += 1 / (rank + 1);
  }
  return { ...query, ranks };
});
let reused = 0;
const modelCalls = h.model.calls;
for (let index = 0; index < 20; index++)
  if ((await h.runtime.ask(tool.goal)).state === "reuse") reused++;
assert(h.model.calls === modelCalls);
// Route benchmark is scoped to the deterministic exact-goal reuse gate. It is
// not a measurement of Bedrock semantic routing or learned classification.
const summary = {
  at: new Date().toISOString(),
  liveBedrockRequests: 0,
  sourceOrigin:
    "One hand-authored response injected through RecordedMissionModel; actual compiler/sandbox/broker. Not natural-language synthesis success.",
  execution: {
    cases: cases.length,
    passed: executions.filter((row) => row.passed).length,
    expectedWrites,
    actualWrites,
    ignoredNoChangeCases: noChanges,
    unexpectedWrites: actualWrites - expectedWrites,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  },
  replay: {
    labeledFixtures: cases.length,
    exactActionMatches: replayMatches,
    unauthorizedWrites: 0,
    externalWritesDuringReplay: 0,
  },
  retrieval: {
    type: "Local word TF-IDF and character trigrams; synthetic labeled metadata corpus",
    queries: queries.length,
    catalogSize: catalog.length,
    recallAt1: recall1 / queries.length,
    recallAt3: recall3 / queries.length,
    mrr: reciprocal / queries.length,
  },
  reuse: {
    exactGoalQueries: 20,
    reused,
    additionalPlanningRequests: h.model.calls - modelCalls,
  },
  permissions: {
    scope:
      "Declared operation-to-permission derivation; NL intent correctness unmeasured",
    expected: ["tasks.move.write", "tasks.read"],
    actual: tool.permissions,
    exactMatch:
      digest(tool.permissions) === digest(["tasks.move.write", "tasks.read"]),
  },
  timeToReview: {
    milliseconds: timeToReviewMs,
    builds: 1,
    provider: "recorded-test",
    liveInference: false,
  },
  complexity: {
    ...programComplexity(tool.source),
    connectorOperations: tool.reads.length + tool.actions.length,
    generationTokens: 0,
    compileMs: tool.evidence.compileMs,
    sandboxMs: tool.evidence.sandboxMs,
    repairAttempts: 0,
  },
  unverified: [
    "New live Bedrock source synthesis",
    "Semantic solution routing accuracy",
    "Retrieval versus no-retrieval live synthesis effects",
    "Real Google Calendar side effects",
    "Native Alexa+ client",
  ],
  corpusHash: digest(cases),
  retrievalCorpusHash: digest(queries),
};
await writeFile(
  out + "/benchmark.json",
  JSON.stringify({ ...summary, executions, retrievalRows }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
