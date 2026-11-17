# Security model

## Promises

1. **Generated programs hold no authority.** A recipe cannot name a file, a
   socket or a process. It returns proposed outputs; the broker decides.
2. **Only a person approves, in the FORGE UI.** No MCP tool and no
   cross-site request can approve anything.
3. **Approval binds to an exact program.** Any change to the stored program
   breaks the hash and the broker refuses to run it.
4. **Default deny.** Inputs need a read grant; outputs need a write grant
   with that exact name and a size ceiling; anything else is refused with a
   receipt.
5. **Nothing leaves this machine.** Server-side HTTP goes through one
   loopback-only function; the browser runs under `connect-src 'self'`; there
   is no telemetry and no automatic model download.
6. **No model-written code runs.** Recipes are interpreted by FORGE's own
   evaluator. The custom-code escape hatch is off.

## Layers

| layer | where | stops |
| --- | --- | --- |
| Recipe language | `core/recipe` | instructions in data, code smuggled into expressions, I/O of any kind |
| Type checker | `core/recipe/engine.ts` | unknown columns, functions, misplaced aggregates, bad patterns |
| Linear-time regex | `core/recipe/regex.ts` | catastrophic backtracking; lookaround and backreferences are not expressible |
| Work budget | `core/recipe/engine.ts` | runaway joins and huge intermediate tables |
| Worker sandbox | `server/sandbox` | timeouts (wall-clock kill), memory (heap ceiling); no env, no paths |
| Human approval | `/api/builds/:id/approve` | self-approval: same-origin JSON only, loopback or owner token |
| Hash binding | `server/broker` | programs altered after approval |
| Read grants | `server/broker` | files outside the grant (exact file / any file / watched folder), oversized inputs |
| Write grants | `server/broker` | undeclared or renamed outputs |
| Size limits | `server/broker` | oversized outputs |
| Revocation | `server/broker`, `server/mcp` | calls to revoked tools; the tool also leaves every client's list |
| Effect keys | `server/store` | replayed events writing twice |
| Egress chokepoint | `server/egress.ts`, CSP | any non-loopback request |

## The Safety Lab

`/safety` runs eleven attacks for real against a scratch FORGE (its own
in-memory store, broker, worker sandbox and MCP hub). Each is also an
automated test (`tests/server/safety.test.ts`); all eleven are blocked:

1. Instructions hidden inside a data file
2. A program proposing an operation it never declared
3. A program altered after approval
4. Reading a file outside the grant
5. Code reaching for the filesystem, network or process
6. An infinite loop or memory bomb
7. An oversized output
8. Calling a revoked tool over MCP
9. A replayed event trying to write twice
10. An assistant trying to approve its own tool
11. A pathological regular expression

`tests/server/egress.test.ts` also scans `src/` for outbound primitives and
instruments sockets through a full build, approval, run, revocation and all
eleven attacks: every socket is loopback.

## HTTP

- The `Host` header must be loopback, unless `FORGE_OWNER_TOKEN` is set and
  the request carries `Authorization: Bearer <token>` (constant-time compare).
- Mutating routes require `content-type: application/json` and, when an
  `Origin` is present, the same host. This blocks cross-site form posts and
  DNS-rebinding pages.
- Production CSP: `default-src 'self'; script-src 'self' 'unsafe-inline';
  connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; …`
  with no `unsafe-eval` (Next.js needs it only in development).

## Models

FORGE only talks to Ollama on 127.0.0.1 (ports 11434 and 11435 are probed),
skips cloud-proxied models, never pulls a model, and refuses redirects. Inside
FORGE's own container, `host.docker.internal` is admitted only when
`FORGE_IN_DOCKER=1` (set by `compose.yaml`); the published port is bound to
loopback.

## What this does not cover

- `node:vm` is used only to run TypeScript FORGE itself emitted from an
  approved recipe for translation validation; it is not a security boundary
  and never runs model text.
- A local user with write access to `.forge/forge.db` can delete or rewrite
  receipts; the hash binding still prevents a tampered program from running.
- Data files are untrusted: a recipe can copy any text from a file into an
  output, including text that *looks* like instructions. It cannot act on it.
