# Execution and outcome verification

Executing a program and satisfying a user's goal are separate claims. Product
runs retain their existing `done`, `failed`, and `ignored` execution statuses and
add optional `verification` evidence. New executions always record this evidence;
historical runs without it are treated as unverified when deduplicated.

```ts
verification: {
  status: "verified" | "failed" | "unverified";
  checks: Array<{
    name: string;
    status: "verified" | "failed" | "unverified";
    details: string;
  }>;
  durationMs: number;
}
```

`verified` means the approved, declared postconditions passed, including available
committed-state checks. It does not prove arbitrary natural-language intent. A
separate mission evaluator must determine whether those conditions capture the
requested goal. Generated test expectations and connector acknowledgements alone
are insufficient evidence of mission completion.

Draft programs can declare up to 20 optional postconditions:

```ts
type Postcondition =
  | {
      kind: "effect";
      operation: string;
      arguments?: Record<string, unknown>;
      count: number; // Integer, 0..20. Exact matching operation count.
    }
  | {
      kind: "artifact";
      name: string;
      format: "csv" | "text" | "json";
      schema?: Record<string, unknown>;
    }
  | {
      kind: "readback";
      operation: string;
      arguments: Record<string, unknown>;
      schema: Record<string, unknown>;
    };
```

Effect conditions reference declared writes. Optional arguments match the entire
approved invocation exactly. Readback conditions use declared read operations,
validate their arguments, and therefore inherit the same explicit permissions
and connection binding. They cannot introduce a new connector or a write during
verification. Their schemas validate fresh responses after writes commit.

Artifact conditions require exactly one matching `workspace.save` operation in
the current run. Earlier files with the same name do not satisfy the condition.
The workspace verifier reads persisted storage after the transaction completes
and checks the effect identity, requested name and format, exact text, byte count,
and SHA-256 integrity. Its transient readback is decoded for schema checking:

- JSON: the parsed JSON value.
- CSV: `{ columns: string[], rows: Record<string, string>[] }`.
- Text: the string itself.

Raw readback contents are not added to public verification evidence. Schema
checks are synchronous; asynchronous validators are rejected. Conditions are
bounded and validated before installation. Demonstrably missing effects or
invalid proposed output schemas are rejected before any write is admitted.

Connectors can implement the optional trusted hook:

```ts
verify(operation, arguments, contextWithCommittedReceipt)
  => Promise<{
    status: "verified" | "failed" | "unverified";
    reason: string;
    data?: unknown; // Transient committed-state readback.
  }>
```

The hook runs outside the write transaction, has a five-second deadline, and is
never retried automatically. A connector without a hook remains unverified even
when fresh declared readback satisfies its approved postcondition. A readback schema
expresses the approved state assertion; it is not a universal proof that every
field or every external effect changed correctly. Readback success never covers
every write on the same connector: an opaque acknowledgement requires a trusted
effect-specific confirmation hook before its write can be marked verified.

Failed required verification produces a failed run and retains committed receipts
and outbox entries. Explicit retries of the same event can recheck the outcome
without resending committed writes. Uncertain writes remain blocked by the
existing outbox rules. Programs with absent or empty postconditions keep legacy
execution behavior and explicitly record an unverified mission outcome.

Postconditions and optional `{ kind: "forge-ir/v1", ir, compilerVersion }`
representation metadata participate in the exact approval hash when present.
They persist with the program and survive a connection recheck. Absent fields
do not change historical program hashes. Representation metadata alone does not
prove that source implements the IR; compiler consistency needs its own check.

Bulk verification uses local stores and controlled connector fixtures. This work
does not change Google access, perform live Google calls, invoke a model, or use
paid cloud services.
