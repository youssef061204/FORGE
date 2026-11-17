# ForgeSpec / 1

Executable interfaces now include deadline/v1 and city/v1. [City](CITY.md) adds a strict GoalContract, city.observe -> executable.run -> city.apply workflow and nine City permissions derived from the exact declared action manifest. Existing career and apartment contracts remain valid. [Lab evidence](LAB.md) uses the same executable and authority boundaries.

ForgeSpec is a constrained executable intermediate representation, not arbitrary model-written source. The schema is exported to `packages/forgespec/schema.json`. A generated example lives in `packages/forgespec/examples/internship-scout.json`.

Required fields: identity/name/description, semantic version and optional parent, creation time, intent, trigger, MCP tool contract, nodes, matching edges, exact permissions, resource policies and modification reason.

Each node has an identifier, allowlisted operation, typed bounded configuration, dependencies, timeout and maxAttempts. The runtime supports posting/resume retrieval, schema normalization, deterministic candidate matching, conditional threshold, cover-letter construction, document/notification writes, extractive summaries and text transforms.

Validation rejects unknown keys and operations, duplicate identifiers or operations, cycles, dangling dependencies, inconsistent edges, missing typed input ancestry, over/under-permission, invalid resource budgets, approval-policy overrides and noncanonical MCP contracts. At most 24 nodes and 3 attempts per node are allowed. Each operation occurs once per DAG; generalized multiple-node bindings are future work.

MCP tool names replace capability hyphens with underscores. Job tools accept eventId + jobPosting; text tools accept eventId + text. Inputs are validated by the SDK and runtime. Outputs include execution identity, status, trace and redacted outcomes. Model-generated tool schemas cannot expand the supported contract.

The release envelope adds immutable artifacts, derived test names, actual test/security reports, semantic diff, reuse metrics, approval timestamps, digest and model usage. A minor extension preserves ID and parent, adds nodes/permissions and requires fresh checks/approval. Rollback restores only a previously approved passing version.
