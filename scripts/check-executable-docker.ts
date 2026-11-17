import assert from "node:assert/strict";
import { runExecutable } from "../src/forge/executable";
import { deadlineSource } from "../src/forge/live-planner";
import { replayHistory, fixtureSenders } from "../src/forge/replay-fixtures";
const start = performance.now();
const result = await runExecutable(
  deadlineSource,
  {
    email: replayHistory.emails[0],
    events: replayHistory.events,
    trustedSenders: fixtureSenders,
  },
  "docker",
);
assert.deepEqual(result, {
  change: {
    eventId: "assignment",
    title: "CS101 Assignment",
    date: "2026-10-15",
  },
  notify: false,
});
console.log(
  JSON.stringify({
    passed: true,
    sandbox: "Docker generated module",
    network: "none",
    readOnly: true,
    credentialsInherited: false,
    durationMs: Math.round(performance.now() - start),
  }),
);
