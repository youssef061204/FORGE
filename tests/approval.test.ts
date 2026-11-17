import { it, expect } from "vitest";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import {
  scoutRequest,
  extensionRequest,
  postings,
} from "../src/forge/fixtures";
import { createForgeMcpServer } from "../src/forge/mcp-registry";

it("rejects an update without removing the active tool; repeated approval and rejection are idempotent", async () => {
  const service = new ForgeService(new MemoryStateStore());
  const buildId = crypto.randomUUID();
  const first = await service.propose(scoutRequest, buildId);
  expect(service.buildProgress(buildId)?.status).toBe("ready");
  expect(service.buildProgress(buildId)?.stages.map((s) => s.name)).toContain(
    "Running security checks",
  );
  expect(
    first.buildStages?.every((s) => typeof s.durationMs === "number"),
  ).toBe(true);
  await Promise.all([
    service.approve(
      first.definition.id,
      first.definition.version,
      first.digest,
    ),
    service.approve(
      first.definition.id,
      first.definition.version,
      first.digest,
    ),
  ]);
  await expect(
    service.approve(first.definition.id, first.definition.version, "wrong"),
  ).rejects.toThrow("integrity");
  const extension = await service.propose(extensionRequest);
  await service.reject(
    extension.definition.id,
    extension.definition.version,
    extension.digest,
  );
  await service.reject(
    extension.definition.id,
    extension.definition.version,
    extension.digest,
  );
  await expect(
    service.approve(
      extension.definition.id,
      extension.definition.version,
      extension.digest,
    ),
  ).rejects.toThrow("not awaiting");
  const state = await service.store.read();
  expect(
    state.audit.filter((a) => a.action === "release.approved"),
  ).toHaveLength(1);
  expect(
    state.audit.filter((a) => a.action === "release.rejected"),
  ).toHaveLength(1);
  const { server, registry } = await createForgeMcpServer(service);
  try {
    expect(registry.listTools()[0].version).toBe("1.0.0");
  } finally {
    await server.close();
  }
  const execution = await service.trigger(first.definition.id, {
    id: "rejected-update-proof",
    type: "new_job_posting",
    payload: { posting: postings.amd },
  });
  expect(execution.version).toBe("1.0.0");
  expect(execution.events?.map((event) => event.event)).toContain(
    "permissions.loaded",
  );
});
