# .agents

Task playbooks for coding agents. Start at [`../AGENTS.md`](../AGENTS.md) — it has the commands, the
one architectural invariant, and the traps that compile cleanly and fail at runtime.

These files exist because the same handful of changes get asked for repeatedly, and each one touches
a specific set of files in a specific order. Following the order matters: the layering is enforced by
ESLint, so building a feature bottom-up passes at every step, while building it top-down fails until
the last file lands.

## Playbooks

| File | Use it when |
|---|---|
| [`skills/add-a-task-type.md`](./skills/add-a-task-type.md) | Adding a new kind of work the engine can execute |
| [`skills/add-an-api-endpoint.md`](./skills/add-an-api-endpoint.md) | Exposing anything new over HTTP |
| [`skills/change-the-scheduler.md`](./skills/change-the-scheduler.md) | Touching fairness, priority, dispatch or retry |
| [`skills/add-a-frontend-feature.md`](./skills/add-a-frontend-feature.md) | Any React work |
| [`skills/debug-the-stack.md`](./skills/debug-the-stack.md) | Something does not work and you need to find out why |

## Reading order for a new agent

1. [`../AGENTS.md`](../AGENTS.md) — the traps, the gate, the one rule
2. [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §2 (who owns what) and §4 (fairness) — the two sections
   that explain most of the code
3. The playbook for your task

Everything else can be read on demand.

## A note on scope

This codebase was built to a brief that explicitly scores over-engineering against it. Simplicity
here is usually a documented decision, not an omission — the **Trade-offs** table in
[`../README.md`](../README.md) lists them. Check it before "fixing" something that looks too simple.
