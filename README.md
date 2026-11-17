# FORGE

When an AI assistant needs a tool it doesn't have, FORGE builds it. You describe
a result in plain language, a local model drafts small programs, FORGE tests
them, shows exactly what the winner may touch, and on your approval installs it
as a tool any MCP assistant can call. Nothing is paid, and nothing leaves the
machine.

FORGE 2 is being rebuilt on the `forge-2` branch. Progress: `docs/OVERHAUL.md`.

## Earlier research

The previous generation (a household simulator, a city simulator, Google
connectors, AWS adapters and a TypeScript-generating pipeline) is preserved at
the [`legacy-v0`](https://github.com/youssef061204/FORGE/tree/legacy-v0) tag.
Its last measured result on the 18-mission development set was 7 of 18 with the
older TypeScript path; rerun unmodified before this overhaul, its newer IR path
solved 1 of 18 on qwen2.5:7b-instruct
([result](evaluation/results/2026-11-17-c8b172f-legacy-baseline/result.json)).
