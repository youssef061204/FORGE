import { writeFile } from "node:fs/promises";
// This evaluator runs the frozen controllers through the same actual worker and
// broker as generated programs; it must never report a training loss as success.
export async function benchmarkControllers() {
  const { runControllerBenchmark } =
    await import("../../src/forge/city-controllers");
  const result = await runControllerBenchmark();
  await writeFile("artifacts/ml/rl.json", JSON.stringify(result, null, 2));
}
