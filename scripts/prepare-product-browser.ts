import { mkdir, writeFile } from "node:fs/promises";
import { draft, synthesis } from "../tests/product-fixtures";
import { solutionSchema } from "../src/forge/product/contracts";
function browserDraft(date: string) {
  const result = draft(date);
  result.source = result.source.replaceAll('"tasks.move"', '"testtasks.move"');
  result.reads[0].operation = "testtasks.list";
  result.actions = ["testtasks.move"];
  for (const test of result.tests) {
    test.expectedOperations = test.expectedOperations.map(
      () => "testtasks.move",
    );
    const observation = test.input.observations.tasks as {
      tasks: { id: string }[];
    };
    for (const item of observation.tasks) item.id = "task-a";
  }
  return result;
}
await mkdir("artifacts/product-browser", { recursive: true });
const first = synthesis(browserDraft("2026-10-20"));
const id =
  "deadline-watcher-" +
  (await import("../src/forge/hash"))
    .digest("Keep my course deadline synchronized")
    .slice(0, 8);
const responses = [
  first,
  {
    ...synthesis(browserDraft("2026-10-21")),
    route: "EXTEND",
    existingIds: [id],
  },
  {
    route: "CONNECT",
    explanation:
      "A connected music service is needed for playback. No media connection is configured.",
    existingIds: [],
    missingConnections: ["Music service"],
  },
].map((response) => solutionSchema.parse(response));
await writeFile(
  "artifacts/product-browser/responses.json",
  JSON.stringify(responses, null, 2),
);
console.log(
  "Prepared three explicit recorded test responses; zero Bedrock requests.",
);
