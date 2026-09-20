# server/AGENTS.md

Express API and the worker process. **One codebase, two entrypoints** — `server.ts` starts the HTTP
server, `worker.ts` starts the dispatcher, and docker-compose runs the same image with a different
command.

Read [`../AGENTS.md`](../AGENTS.md) first for the traps that compile cleanly.

## Layout

```
app.ts          builds the Express app, does not listen — that is what makes it testable
server.ts       api entrypoint
worker.ts       worker entrypoint
container.ts    composition root: the only place in the app that calls `new`

config/         env.ts (zod-parsed at boot) · constants.ts (every tunable)
lib/            mysql · redis · redis-keys · logger · migrator · rate-limiter · progress-store
schemas/        request-shape zod schemas (params, query strings)
routes/         URL → controller. No logic.
controllers/    req/res only. One service call each.
services/       business logic. Never imports express.
repositories/   SQL. Never imports services.
middlewares/    auth · validate · rate-limit · request-id · error · not-found
engine/         the execution engine — a domain module, not a layer
events/         event-bus (Redis pub/sub) · sse-hub
utils/          errors · time
```

`engine/` and `events/` sit outside the layering because a background execution engine does not fit
the CRUD shape. Everything else follows `routes → controllers → services → repositories`, and ESLint
fails the build if you cross a boundary.

## Two configs

`tsconfig.json` checks everything including tests and emits nothing — the editor, ESLint and
`npm run typecheck` all resolve to it. `tsconfig.build.json` emits `dist/` from `src` only; tests
never ship in the image.

## Engine at a glance

| File | Job |
|---|---|
| `dispatcher.ts` | The loop. 200ms poll; picks a client, pops a task, claims it, runs it. |
| `fair-scheduler.ts` | Deficit Round Robin over clients. Pure, no I/O. |
| `ready-queue.ts` | Redis ZSET per client. Priority-then-FIFO in one score. |
| `worker-pool.ts` | N worker threads. Pool size is the concurrency limit. |
| `task-runner.ts` | Runs inside a thread. Sleeps in ticks, checks for cancellation. |
| `task-executor.ts` | Owns the pool; leases, progress, worker stats. |
| `task-recovery.ts` | Retry vs dead-letter. Shared by the pool and the reaper. |
| `lease-reaper.ts` | Reclaims tasks whose whole process died. 10s. |
| `reconciler.ts` | Repairs MySQL/Redis drift. 30s. |

Three recovery mechanisms, one failure mode each: the pool's `exit` handler (a thread died), the
lease reaper (the container died), the reconciler (the two stores disagree). Do not try to merge
them — each is simple because none covers everything.

## Adding config

Every tunable goes in `config/constants.ts` with a comment saying what it trades off, or in
`config/env.ts` if it should be settable per deployment. No magic numbers in engine code.

`env.ts` parses `process.env` with zod at boot and exits on a bad value. It is the one file allowed
to use `console` — the logger depends on it.

## Errors

Throw from `utils/errors.ts`; never set a status code outside `error.middleware.ts`.

`FatalError` and `RetryableError` are read by the engine, not just by HTTP: fatal means the task can
never succeed and skips retries entirely. Choosing wrong either burns three retries on doomed work or
gives up on recoverable work.

## Tests

`npm test` — Vitest, fakes for MySQL and Redis, under a second. Scoped to the parts that would be
embarrassing to get wrong: fairness, retry/dead-letter, rate-limit window boundaries, queue ordering.

Keep `FairScheduler` pure so its tests stay pure. If a test needs Redis, the design drifted.
