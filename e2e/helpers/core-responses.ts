import { digest } from "../../src/forge/hash";
import {
  solutionSchema,
  type Invocation,
  type ProgramDraft,
  type Solution,
} from "../../src/forge/product/contracts";

// Authored regression recordings, never production planning or holdout answers.
// These cover transport, compiler, broker and UI boundaries, not model quality.
export const coreGoals = {
  novel: "Save a local acceptance memo containing the words browser proof",
  extend: "Update that memo tool to include an extra second line",
  multiple: "Save a local checkpoint file and notify me inside FORGE",
  missing: "Play music using a music service that is not connected",
  clarify: "Change the schedule without specifying which schedule or date",
  invalid: "Build an intentionally malformed regression candidate",
};
export const coreOwnerToken = "core-browser-test-owner-token-v1";
export const memoName = "Acceptance memo";
export const checkpointName = "Acceptance checkpoint";

function program(
  name: string,
  filename: string,
  text: string,
  notify = false,
): ProgramDraft {
  const operations: Invocation[] = [
    {
      operation: "workspace.save",
      arguments: { name: filename, format: "text", text },
    },
    ...(notify
      ? [
          {
            operation: "notification.emit",
            arguments: { message: "Local checkpoint saved" },
          },
        ]
      : []),
  ];
  const output = {
    operations,
    result: { summary: `${name} completed`, details: [] },
    state: {},
  };
  return {
    name,
    description: `Save ${filename} in the isolated browser regression workspace.`,
    source: `function execute(input: ModuleInput): ModuleOutput { return ${JSON.stringify(output)}; }`,
    reads: [],
    actions: operations.map((item) => item.operation),
    trigger: { kind: "manual" },
    postconditions: [
      { kind: "artifact", name: filename, format: "text" },
      { kind: "effect", operation: "workspace.save", count: 1 },
      ...(notify
        ? [
            {
              kind: "effect" as const,
              operation: "notification.emit",
              count: 1,
            },
          ]
        : []),
    ],
    tests: ["ordinary input", "empty input"].map((name, index) => ({
      name,
      input: {
        now: "2026-11-16T15:00:00.000Z",
        input: index ? {} : { note: "untrusted input is not executable" },
        observations: {},
        state: {},
      },
      expectedOperations: operations.map((item) => item.operation),
      expectedEffects: operations,
      expectedOutput: output,
    })),
  };
}

function synthesize(draft: ProgramDraft): Solution {
  return {
    route: "SYNTHESIZE",
    explanation: "Build the regression candidate from available local operations.",
    existingIds: [],
    missingConnections: [],
    program: draft,
  };
}

export function coreResponses() {
  const original = program(memoName, "acceptance-memo.txt", "browser proof");
  const extension = program(
    memoName,
    "acceptance-memo.txt",
    "browser proof\nsecond line",
  );
  const invalid = program("Invalid acceptance candidate", "invalid.txt", "never saved");
  invalid.source =
    "function execute(input: ModuleInput): ModuleOutput { return missingRegressionSymbol; }";
  const id = "acceptance-memo-" + digest(coreGoals.novel).slice(0, 8);
  return [
    synthesize(original),
    {
      ...synthesize(extension),
      route: "EXTEND",
      existingIds: [id],
    },
    synthesize(
      program(checkpointName, "acceptance-checkpoint.txt", "local checkpoint", true),
    ),
    {
      route: "CONNECT",
      explanation: "A connected music service is needed for playback.",
      existingIds: [],
      missingConnections: ["Music service"],
    },
    {
      route: "CLARIFY",
      explanation: "The schedule and target date are not specified.",
      question: "Which schedule should change, and what is the target date?",
      existingIds: [],
      missingConnections: [],
    },
    synthesize(invalid),
  ].map((response) => solutionSchema.parse(response));
}
