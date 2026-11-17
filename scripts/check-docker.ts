import { demoPlan } from "../src/forge/compiler";
import { IsolatedSandbox } from "../src/forge/sandbox";
import { MemoryStateStore } from "../src/forge/store";
import { scoutRequest, postings } from "../src/forge/fixtures";
const execution = await new IsolatedSandbox("docker").run(
  demoPlan(scoutRequest),
  {
    id: "docker-verification",
    type: "new_job_posting",
    payload: { posting: postings.amd },
  },
  new MemoryStateStore(),
);
console.log(
  JSON.stringify(
    {
      status: execution.status,
      error: execution.error,
      sandbox: execution.sandbox,
      traceSteps: execution.trace.length,
      latencyMs: execution.latencyMs,
    },
    null,
    2,
  ),
);
if (execution.status !== "success") process.exitCode = 1;
