# AGENTS.md

Context for coding agents working in this repository. Humans want
[README.md](./README.md) (what it does, how to run it) and
[ARCHITECTURE.md](./ARCHITECTURE.md) (how it is built and why).

This file covers what those two do not: the decisions that look arbitrary until you know the reason,
and the traps that compile cleanly and fail at runtime.

## What this is

A distributed task execution engine. Clients submit long-running tasks over HTTP; a pool of worker
threads executes them under a fairness policy; browsers watch progress live over SSE.

npm workspaces: `packages/shared` (zod schemas — the wire format), `server` (Express API + worker
process, one codebase, two entrypoints), `web` (React dashboard).

## Commands

```bash
npm install
npm run build -w @task-engine/shared   # run first if you touched packages/shared

npm run check          # typecheck + lint + format + tests. Run before you finish.
npm run typecheck
npm run lint:fix
npm test

docker compose up --build              # the whole stack on :8080
```

**`npm run check` is the gate.** It is type-aware and enforces the architectural boundaries — the
server's layering and the frontend's feature isolation are ESLint rules, not conventions you need to
remember. If it passes, you have not broken a boundary. Do not restate those rules or re-verify them
by hand.

## The one rule

> **MySQL is the source of truth. Redis is a fast index over it that we can rebuild.**

Every other decision follows from this. Flush Redis and the system repairs itself within 30 seconds.
Lose MySQL and the system is lost.

If you find yourself putting authoritative state in Redis, stop — you are about to invert the
invariant the recovery design depends on.

## Traps that compile cleanly

These are the ones that cost real time. None is caught by the type checker or the linter.

**Read validated input from `req.validated`, never `req.query` or `req.params`.** Express 5 exposes
those as getters, so the validation middleware cannot write back to them. Use the `validated<T>()`
helper. Reading `req.query` directly gives you unvalidated, untyped strings.

**Never write `try/catch` in a controller.** Express 5 forwards rejected promises to
`error.middleware.ts`, which is the only place in the codebase that writes an HTTP status code.
Throw a typed error from `utils/errors.ts` instead.

**`FatalError` vs `RetryableError` is a behavioural choice, not a naming one.** `FatalError` means
the task can never succeed, so it goes straight to `failed` with no retry. `RetryableError` and
crashes retry to `max_attempts` and then dead-letter. Picking the wrong one either wastes three
retries on a task that will always fail, or silently gives up on recoverable work.

**`attempts` increments when a task is claimed, not when it fails.** Retry logic reads it after the
fact. If you move the increment, `retryOrDeadLetter` will be off by one and tasks will get four or
two attempts instead of three retries.

**mysql2 rejects placeholders in `LIMIT` / `OFFSET`.** Interpolate the zod-validated integer
directly, as `task.repository.ts` does, with the comment explaining why. `LIMIT ?` throws at runtime,
not at compile time.

**Timestamps come back from MySQL as strings.** The pool runs with `dateStrings: true` and
`timezone: 'Z'` so the app, not the driver, owns the timezone. Convert with `toIso()` from
`utils/time.ts`; never hand a raw column value to `new Date()`.

**Progress is not a database column.** It lives in Redis with a TTL, because a 30-second task emits
~30 updates and that churn does not belong in a table analytics queries scan. Read it through
`ProgressStore`.

**Relative imports in `server/` need the `.js` extension**, even from `.ts` files — the project is
ESM with `NodeNext` resolution. `tsc` will tell you, but it surprises people first.

**`packages/shared` must be rebuilt before the other workspaces typecheck against it.** Consumers
resolve `dist/`, not `src/`.

## Do not over-engineer this

This codebase was built to a brief that explicitly scores over-engineering against it: no Kubernetes,
no GraphQL, no microservices, no 100% coverage. Existing simplicity is usually deliberate and
documented:

- The dispatcher is a 200ms poll loop, not an event pipeline. The reconciler guarantees nothing is
  lost, so the simple shape costs a fifth of a second and removes a class of wakeup bugs.
- Analytics are plain `GROUP BY` queries run per request. Rollup tables are the documented next step,
  not a missing feature.
- There is no interface with a single implementation anywhere. Do not add one.
- Pagination is offset-based on purpose; keyset is in the scaling write-up.

If you think something is missing, check the **Trade-offs** table in README.md first. It is probably
a decision rather than an oversight.

## Verifying a change actually works

Typechecks and unit tests do not prove the system runs. For anything touching the engine, Redis,
or the API surface, exercise it:

```bash
docker compose up -d --build
curl -s localhost:8080/api/health

# 60 tasks with a distribution that demonstrates fairness
curl -sX POST localhost:8080/api/dev/seed -H 'X-API-Key: acme-key-001'

# kill a busy worker thread and watch the task be retried
curl -sX POST localhost:8080/api/dev/kill-worker -H 'X-API-Key: acme-key-001'
docker compose logs worker | grep -iE 'crash|retry|dead letter'
```

Seeded API keys: `acme-key-001`, `globex-key-002`, `initech-key-003` (weight 2.0),
`umbrella-key-004`.

Logs are JSON on stdout. `docker compose logs | grep '"level":"error"'` should be empty except for
deliberate thread kills.

## Task playbooks

Step-by-step guides for the changes most likely to be asked for live in
[`.agents/skills/`](./.agents/skills/):

| Task | Playbook |
|---|---|
| Add or change a task type | [`add-a-task-type.md`](./.agents/skills/add-a-task-type.md) |
| Add an API endpoint | [`add-an-api-endpoint.md`](./.agents/skills/add-an-api-endpoint.md) |
| Touch the scheduler or fairness | [`change-the-scheduler.md`](./.agents/skills/change-the-scheduler.md) |
| Frontend work | [`add-a-frontend-feature.md`](./.agents/skills/add-a-frontend-feature.md) |
| Something is broken | [`debug-the-stack.md`](./.agents/skills/debug-the-stack.md) |

`server/AGENTS.md` and `web/AGENTS.md` carry the details for each workspace. Agents read the nearest
file to whatever they are editing.

## Conventions worth knowing

Classes exist where there is state and a lifecycle (`WorkerPool`, `FairScheduler`, `TaskService`).
Everything else is a plain function. Every `new` in the application happens in `container.ts`.

Comments explain *why*, never *what*. Most files have none. The ones that do — the ZSET score
encoding, the DRR deficit reset, the cancel race — are the places where the reason is not recoverable
from the code.

Commit messages describe the decision, not the diff.
