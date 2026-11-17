# World visual direction and verification

The visual pass makes `/world` a viewport-sized pixel game with a small ability inventory and dialogue bar. The apartment is the hero. The existing compiler, world primitives, approval, MCP lifecycle and Bedrock configuration are retained.

## Presentation

- Original cream, sage and wood HUD; dark blue night exterior. The stage occupies roughly three quarters of the arena width on the 1440×900 recording viewport.
- Distinct room furniture, rugs, windows and natural light, workstation chair, glowing monitor, fridge/appliance indicators, coat/shoe rack and visible door lock stamp.
- Clouds, leaves, stars, monitor breath and character idle movement provide restrained ambient life. Leaving and arriving animate through the entrance; studying ends at the workstation with a book. These are deterministic visual transitions after confirmed execution, without pathfinding.
- Room darkness and warm lamp pools reflect actual light state. Monitor/TV screens reflect device state. The energy bar interpolates between confirmed backend values; its number always shows the real current derived load, with no invented intermediate readings.
- A 2.4-second forging acknowledgment uses the returned validated proposal and its actual primitives/check count. Backend stages remain measured observations, and approval is available immediately. It does not hold execution or manufacture progress.
- Ability unlock, upgrade version/diff and rollback feedback use actual release records. A compact feed shows recorded broker operations after the call; it does not claim streaming execution.
- Guard presentation shows the persisted malicious message, attempted edge, shield, denied operation and unchanged lock. The broker remains the authority; there is no new language-model injection detector.

All animations are decorative projections of known outcomes. Scene inputs remain labeled owner inputs. The simulated clock does not advance autonomously. Reduced-motion preferences disable CSS movement and transitions.

## Controls and evidence

**Inspect MCP** opens a native modal drawer with T0/T1 tool lists, a compact added-tool diff, canonical ForgeSpec, tests, permissions, trace, provider/usage and version history. Registry refresh uses the actual SDK. The drawer traps focus through the browser's native dialog behavior and supports Escape/close without navigating away.

**Mail & Guard** shows the mailbox message and runs the same real red-team probe. **Scene inputs** exposes Active day, Night arrival and Away for 45 min. **Demo mode** enlarges the stage and reduces inventory/device clutter while retaining request, approval, invocation, scene/security controls and the technical drawer. It never scripts actions.

**Reset World demo**, inside Scene inputs, restores the deterministic initial world and removes histories, executions and effects belonging only to entirely World-domain capabilities. Any ID with a mixed-domain history is preserved. Internship Scout and other domains remain installed; the audit trail remains. Active builds/executions block reset. The guarded owner endpoint requires the same access/origin enforcement as all existing actions. Reset is a real owner action, not a fake T0 label.

Reset was exercised only in isolated tests. The main demo's persisted records were preserved while rebuilding the container. Reset removes World version history intentionally; use scene inputs instead when comparing extension/rollback.

## Material files

- `src/components/forge-world.tsx`: game HUD, ability inventory, dialogue bar, native drawers, recorded feedback and controls; original SDK/service calls retained.
- `src/components/world-scene.tsx`: original room art, day/night projection, avatar routes and Guard edge.
- `src/components/world-hud.tsx`: reusable native dialog, forging acknowledgment, icons and recorded event feed.
- `src/app/world/world.css`: scoped game presentation, desktop/mobile layout and reduced-motion rules. Studio styles are untouched.
- `src/forge/service.ts`, `src/app/api/forge/route.ts`: one scoped World reset transaction and guarded owner action; no compiler/transport rewrite.
- `tests/world.test.ts`: reset preservation and real MCP removal/rebuild test alongside existing world behavior tests.
- `e2e/world.spec.ts`: drawer access, full real lifecycle, study avatar, demo mode, reset, mobile and reduced motion.
- README, World architecture, demo and verification docs: updated controls, evidence and recording sequence.

Screenshots in ignored `artifacts/`: `world-dashboard-before.png` (prior layout), `world-before.png`, `world-threat.png`, `world-night.png`, `world-study.png`, `world-mobile.png`, `world-cinematic.png`. They come from actual browser state, with animations disabled for deterministic still captures. Production screenshots additionally omit the Next development indicator.

## Executed checks

The final run passed `npm test` (51/51 across seven files), `npm run test:e2e` (14/14 Chromium), `npm run evaluate` (49/49, frozen digest unchanged), `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build`. `docker compose up --build -d --wait` built the Linux image and left the fixture demo healthy on port 3108. `npm run sandbox:check` executed six Docker-worker steps in 380.36ms. Authenticated `npm run verify:http` against an isolated production container on port 3113 passed protocol negotiation, auth/origin checks, T0/T1 creation, invocation, extension, rollback and real broker denial; the container was removed afterward.

The production browser check at `2026-10-07T02:15:53.703Z` recorded no page errors, no horizontal overflow, and a 1073px stage inside a 1404px arena at a 1440×900 viewport (**76.4% of arena width**). `artifacts/world-visual-proof.json` records the measurement and preserved installed releases: Internship Scout v1.1.0 and Leaving Home v1.0.0. `resetInvoked=false` confirms this read-only production check did not reset the main demo. Production screenshots: `world-production.png` and `world-production-proof.png`.

## Limits

This is a lightweight SVG/CSS simulation, with no physics, collision-aware navigation, full sprite sheets or sound. Motion replays a confirmed state change rather than streaming node results. Desktop recording is prioritized; mobile stacks inventory below the viewport. Device load remains illustrative. AWS compilation evidence from the previous pass is preserved; this visual pass makes no extra Bedrock request or cloud infrastructure change.
