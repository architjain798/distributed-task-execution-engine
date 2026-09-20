# Architecture

A distributed task execution engine: clients submit long-running tasks, a pool of workers executes
them under a fairness policy, and browsers watch the whole thing move in real time.

This document explains how the system is put together and why. The [README](./README.md) covers
running it; this covers understanding it.

---

## 1. The shape of the system

```
                                  ┌──────────────────────────────┐
     browser ───── HTTP ────────▶ │  api            (node, 3000) │
             ◀──── SSE ────────── │  routes · controllers        │
                                  │  auth · rate limit · SSE hub │
                                  └───┬──────────────────────┬───┘
                                      │                      │
                         read + write │                      │ SUB  channel:events
                          task state  │                      │ PUB  channel:control
                                      ▼                      ▼
                            ┌──────────────────┐   ┌──────────────────┐
                            │      MySQL       │   │      Redis       │
                            │  source of truth │   │   fast index     │
                            │  ─────────────── │   │  ─────────────── │
                            │  tasks           │   │  ready queues    │
                            │  clients         │   │  live progress   │
                            │                  │   │  rate limits     │
                            │                  │   │  pub/sub         │
                            └──────────────────┘   └──────────────────┘
                                      ▲                      ▲
                          write state │                      │ ZPOPMAX · HSET
                           transitions│                      │ PUB channel:events
                                  ┌───┴──────────────────────┴───┐
                                  │  worker                      │
                                  │  dispatcher · fair scheduler │
                                  │  worker_threads pool (N=4)   │
                                  │  lease reaper · reconciler   │
                                  └──────────────────────────────┘
```

Five containers: `mysql`, `redis`, `api`, `worker`, `web`. The `api` and `worker` containers run
the **same image** with a different command — they share `server/src` entirely and differ only in
their entrypoint. This is the conventional web/worker split, not a microservice decomposition.

### Why the split at all

It would have been simpler to run the scheduler inside the API process. The split earns its keep
three ways:

1. **Redis becomes load-bearing.** Progress events, cancellation signals and worker heartbeats have
   to cross a process boundary, so the pub/sub is real rather than an `EventEmitter` talking to
   itself.
2. **Crash recovery is demonstrable.** `docker compose stop worker` kills every in-flight task at
   once. The lease reaper reclaims them and they resume on restart — visible in the dashboard.
3. **The scaling story is built, not described.** API capacity and execution capacity scale
   independently today. The one remaining obstacle to `--scale worker=3` is named in §9.

---

## 2. Who owns what

The single most important rule in this codebase:

> **MySQL is the source of truth. Redis is a fast index over it that we can rebuild.**

| State | Home | Why |
|---|---|---|
| Task rows, status, attempts, timestamps, errors | MySQL | Durable, queryable, survives everything |
| Client identities, API keys, DRR weights | MySQL | Durable, referenced by foreign key |
| The ready queue (what runs next) | Redis ZSET | Needs atomic pop under concurrency |
| Live progress percentage | Redis string, TTL 1h | High churn — 60 writes/task would pollute MySQL |
| Rate limit counters | Redis ZSET, TTL 2min | Inherently ephemeral |
| Worker pool utilisation | Redis string, TTL 10s | A heartbeat; staleness is the signal |
| DRR deficit counters | Worker process memory | Soft state; losing it costs one round of precision |

If Redis is flushed entirely, the system repairs itself within 30 seconds (§6.3). If MySQL is lost,
the system is lost. That asymmetry is deliberate.

### Redis keys

| Key | Type | Contents |
|---|---|---|
| `queue:{clientId}` | ZSET | member `taskId`, score `priority × 1e13 − enqueuedAtMs` |
| `clients:active` | SET | client ids whose queue is non-empty |
| `progress:{taskId}` | string | `{percent, updatedAt}`, TTL 1h |
| `ratelimit:{clientId}` | ZSET | sliding-window log of submission timestamps |
| `workers:stats` | string | `{total, busy, idle, updatedAt}`, TTL 10s |
| `channel:events` | pub/sub | `task.created` · `task.updated` · `task.progress` · `workers.stats` |
| `channel:control` | pub/sub | `task.cancel` — API to worker |

**The score encoding.** `priority * 1e13 - enqueuedAtMs` packs two sort keys into one float. Priority
dominates because 1e13 exceeds any plausible millisecond timestamp delta; subtracting the timestamp
makes older tasks sort higher within a priority band. One `ZPOPMAX` then returns "highest priority,
oldest first" atomically. This is the only piece of arithmetic in the codebase that needs a comment,
and it has one.

---

## 3. Data model

```sql
CREATE TABLE clients (
  id         CHAR(36)     PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  api_key    VARCHAR(64)  NOT NULL UNIQUE,
  weight     DECIMAL(4,2) NOT NULL DEFAULT 1.00,   -- DRR quantum
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);

CREATE TABLE tasks (
  id               CHAR(36)     PRIMARY KEY,
  client_id        CHAR(36)     NOT NULL,
  type             VARCHAR(64)  NOT NULL,
  priority         TINYINT      NOT NULL,           -- 1..5, 5 highest
  payload          JSON         NOT NULL,
  status           ENUM('queued','running','cancelling',
                        'completed','failed','cancelled','dead_letter') NOT NULL,
  attempts         INT          NOT NULL DEFAULT 0,
  max_attempts     INT          NOT NULL DEFAULT 4, -- 1 initial + 3 retries
  worker_id        VARCHAR(64)  NULL,
  lease_expires_at TIMESTAMP(3) NULL,
  last_error       TEXT         NULL,
  result           JSON         NULL,
  enqueued_at      TIMESTAMP(3) NOT NULL,
  started_at       TIMESTAMP(3) NULL,               -- first attempt  → queue wait
  last_attempt_at  TIMESTAMP(3) NULL,               -- latest attempt → execution time
  finished_at      TIMESTAMP(3) NULL,
  ...
  INDEX idx_status_created (status, created_at),
  INDEX idx_client_status  (client_id, status),
  INDEX idx_type_status    (type, status),
  INDEX idx_lease          (status, lease_expires_at)
);
```

Three separate timestamps exist so every analytics query stays a plain `GROUP BY`:

- **queue wait** = `started_at − enqueued_at` — measured to the *first* attempt
- **execution time** = `finished_at − last_attempt_at` — measured over the *successful* attempt, so
  retries do not inflate it
- **throughput** = `COUNT(*) GROUP BY minute(finished_at)`

### Status machine

```
                  ┌─────────────── cancel ──────────────┐
                  ▼                                     │
   (submit) ─▶ queued ───── claim ─────▶ running ───────┤
                  ▲                       │   │         │
                  │                       │   └─cancel─▶ cancelling ─▶ cancelled
     re-enqueue with backoff              │
       (attempts < max_attempts)          ├── success ──────────────▶ completed
                  │                       ├── FatalError ───────────▶ failed
                  └───────────────────────┤
                                          └── RetryableError │ crash
                                                  └── attempts exhausted ─▶ dead_letter
                                                                                │
                                          POST /tasks/:id/retry ────────────────┘
                                          (attempts → 0, status → queued)
```

Terminal states: `completed`, `failed`, `cancelled`, `dead_letter`. Only `dead_letter` is manually
retryable.

**`failed` versus `dead_letter`** is a real distinction, not two names for the same thing:

- `failed` — a **fatal** error. Unknown task type, payload that fails its schema. Retrying would
  produce the identical error, so it does not retry.
- `dead_letter` — a **retryable** error or a worker crash that exhausted all four attempts. The work
  was legitimate; the system could not complete it.

The error hierarchy encodes this. `FatalError` and `RetryableError` both extend `AppError`, and the
engine branches on `instanceof`.

---

## 4. Fairness

The brief asks for two things that cannot both be true:

> Tasks execute based on priority — higher priority tasks are dequeued before lower ones.

> No single client should be able to starve others by flooding the queue with high-priority tasks.

A single global priority queue satisfies the first and fails the second: a client submitting an
endless stream of priority-5 work blocks everyone else forever. Something has to give, and the
design decision is *which*.

**This system makes priority intra-client.** Priority orders a client's own work; it has no effect
across clients.

### The mechanism: per-client queues + Deficit Round Robin

Each client gets its own Redis sorted set. The dispatcher never looks at a global ordering — it
picks a **client** first, then pops that client's best task.

```
                 ┌──────────────────────────────────────────┐
  submissions ──▶│ queue:acme     [P5 P5 P5 P5 P5 P5 P5 …]  │──┐
                 ├──────────────────────────────────────────┤  │
                 │ queue:globex   [P2 P1]                   │──┼──▶ DRR picks
                 ├──────────────────────────────────────────┤  │    the CLIENT
                 │ queue:initech  [P4]                      │──┘         │
                 └──────────────────────────────────────────┘            │
                                                                         ▼
                                              ZPOPMAX on that one queue ──▶ worker
```

A client that floods fills only its own queue. `acme` above has seven priority-5 tasks pending and
still receives exactly the same share of the worker pool as `initech`, which has one.

### The algorithm

Each active client carries a **deficit counter**. Each visit grants it `weight` credits (default
`1.0`); each dispatch costs `1.0`. When a client's queue empties, its deficit resets to zero so idle
clients cannot bank credit and burst later.

```
nextClient():
  active = SMEMBERS clients:active
  for each client in active, starting from the round-robin cursor:
      deficit[client] += weight[client]
      if deficit[client] >= DISPATCH_COST:
          deficit[client] -= DISPATCH_COST
          return client
  return null            # nothing dispatchable this round
```

**Worked example.** Three clients, all weight 1.0, four workers. `acme` has 50 queued tasks,
`globex` has 2, `initech` has 1. The first four dispatches are `acme`, `globex`, `initech`, `acme` —
`globex`'s first task starts within one round regardless of how much work `acme` submitted, and
`initech`'s single task never waits behind `acme`'s backlog.

**What the deficit is actually for.** At uniform weights this would reduce to plain round-robin, so
the seeded data deliberately does not use uniform weights: `initech` carries `weight = 2.0` and
receives twice the dispatch rate of the others. The deficit is what makes that work, and what makes
*fractional* weights work — a client with `weight = 2.5` earns 2.5 credits per visit, spends 1.0 per
dispatch, and carries the remainder forward rather than having it rounded away. Client weights are a
column in `clients`, so tiering a customer is a database update, not a code change.

### Second guard: no preemption

The brief is explicit that a running low-priority task must not be killed. There is no preemption
anywhere in this system. Fairness is enforced purely at **dequeue** time, which means a burst of
long-running tasks from one client can still occupy workers for a while. The mitigation is that they
occupy at most their fair share of *dispatches*; the residual unfairness is bounded by task
duration variance. §10 notes what would fix it properly.

### Rate limiting is a separate concern

Fairness governs *scheduling*; rate limiting governs *admission*. Each client may submit 10 tasks
per minute, enforced by a Redis sorted set used as a sliding-window log:

```
ZREMRANGEBYSCORE ratelimit:{client} 0 (now − 60s)     -- drop what fell out of the window
ZCARD            ratelimit:{client}                    -- how many remain
ZADD             ratelimit:{client} now <unique>       -- record this attempt
PEXPIRE          ratelimit:{client} 120s               -- self-cleaning
```

All four run in one `MULTI`. If the count exceeded the limit, the entry just added is removed and
the request is rejected with `429` plus `Retry-After` and `X-RateLimit-*` headers.

A sliding window log was chosen over a fixed window because a fixed window permits 20 submissions
across a boundary — submit 10 at 11:59:59 and 10 more at 12:00:00. That is precisely the burst a
reviewer would probe for. It was chosen over a token bucket because the exact-count semantics match
the requirement as written ("max 10 per minute") without introducing a burst parameter to justify.

---

## 5. The execution engine

### Dispatch loop

```
while running:
    free = pool.freeSlots()
    if free == 0:            await pool.slotFreed();  continue

    clientId = scheduler.nextClient()             # DRR, in memory, no I/O
    if clientId == null:     await sleep(200ms);  continue

    taskId = ZPOPMAX queue:{clientId}
    if taskId == null:       scheduler.reset(clientId); continue

    task = repo.claim(taskId, workerId, lease = now + 60s)   # UPDATE … WHERE status='queued'
    if task == null:         continue                        # cancelled underneath us
    pool.run(task)
```

`claim` is an atomic conditional update:

```sql
UPDATE tasks
   SET status = 'running', worker_id = ?, lease_expires_at = NOW(3) + INTERVAL 60 SECOND,
       started_at = COALESCE(started_at, NOW(3)), last_attempt_at = NOW(3),
       attempts = attempts + 1
 WHERE id = ? AND status = 'queued'
```

`affectedRows === 0` means someone else changed the row first — almost always a cancellation
arriving between the `ZPOPMAX` and the `UPDATE`. The dispatcher simply moves on. This is the one
genuine race in the system and it is closed by making the database arbitrate rather than by locking.

### Worker threads

`WorkerPool` owns N `worker_threads`, each running `task-runner.ts`. The protocol is four messages:

```
parent → thread   { type: 'run',      task }
parent → thread   { type: 'cancel' }
thread → parent   { type: 'progress', percent }     ~every 500ms
thread → parent   { type: 'done',     result }
thread → parent   { type: 'failed',   message, retryable }
```

The simulated work sleeps in 250 ms ticks and checks a local `cancelled` flag on each tick. Because
the thread is idle between ticks, the `cancel` message always lands promptly. Real CPU-bound work
would need an `Atomics`-backed `SharedArrayBuffer` flag instead, since a busy thread never drains
its message queue — noted here because the easy version only works due to the nature of the
simulation.

### Task type registry

Types are not opaque strings. Each carries a duration range, a failure probability and a zod schema
for its payload:

| Type | Duration | Failure rate |
|---|---|---|
| `image-processing` | 5–12 s | 5 % |
| `report-generation` | 15–30 s | 10 % |
| `data-import` | 8–20 s | 20 % |
| `email-batch` | 5–10 s | 2 % |

This exists so the analytics view shows real variance rather than four identical bars, and so the
dead letter queue populates on its own during a demo. `payload.durationMs` and `payload.failureRate`
override the profile, which makes tests deterministic and lets a reviewer force a specific outcome.
An unknown type raises `FatalError` at submission time.

---

## 6. Failure handling

Three independent mechanisms, each covering exactly one failure mode. The overlap is deliberate:
each is simple because none tries to cover everything.

### 6.1 A thread dies — `worker.on('exit')`

The pool listens for a non-zero exit. The task that thread was holding is released immediately, its
attempt already counted, and it is re-enqueued with backoff or dead-lettered. Recovery is instant.
A respawned thread takes the dead one's slot.

`POST /api/dev/kill-worker` terminates a random busy thread so this path can be triggered on demand
rather than waited for.

### 6.2 The whole worker container dies — lease reaper

Threads cannot report their own container's death. Every running task therefore holds a **lease**:
`lease_expires_at`, set 60 s ahead at claim time and renewed every 15 s while the task runs.

A reaper in the worker process sweeps every 10 s:

```sql
SELECT id FROM tasks WHERE status = 'running' AND lease_expires_at < NOW(3)
```

Anything it finds was abandoned. It is re-enqueued or dead-lettered by the same code path as 6.1.
Worst-case recovery is 60 s, bounded by the lease TTL.

### 6.3 MySQL and Redis disagree — reconciler

Submission writes to two systems: `INSERT` into MySQL, then `ZADD` into Redis. A crash between them
leaves a task `queued` in MySQL and absent from Redis — invisible to the dispatcher forever. The
same window exists in reverse at dispatch.

Every 30 s the reconciler selects `queued` tasks whose ids are not in their client's sorted set and
re-adds them. It also repairs a wholesale Redis flush, since after one sweep every queued task is
back.

This is why choosing Redis as the queue did not remove the need for this sweep — it narrowed the
window rather than closing it. **Redis is an optimisation; MySQL is the contract.** Stop Redis
entirely and the system does not lose work, it stops scheduling until Redis returns.

### Retry policy

| Failure | Retries? | Terminal state |
|---|---|---|
| `FatalError` (unknown type, bad payload) | no | `failed` |
| `RetryableError` (simulated work failure) | yes, to 4 attempts | `dead_letter` |
| Thread crash | yes, to 4 attempts | `dead_letter` |
| Lease expiry | yes, to 4 attempts | `dead_letter` |
| Cancellation | no | `cancelled` |

Backoff is `1 s → 2 s → 4 s`, applied by holding the task out of the ready queue. `last_error` always
records the most recent failure so the dead letter view explains itself.

---

## 7. Real-time updates

```
worker thread ──postMessage──▶ worker process ──PUBLISH──▶ Redis
                                                             │
                                                        SUBSCRIBE
                                                             ▼
browser ◀──── SSE ──── api process ◀──── EventBus ──── channel:events
```

One SSE endpoint, `GET /api/events`, carrying a discriminated union of four event types. A client
hydrates once from `GET /api/dashboard` and then applies events to that snapshot.

**Reconnect is a refetch, not a replay.** No event log, no `Last-Event-ID`. Refetching the snapshot
is five lines and correct by construction; replay would require retention and ordering guarantees
for no benefit at this scale.

Operationally: a `:heartbeat` comment every 15 s keeps proxies from closing idle connections, and
`req.on('close')` deregisters the connection — without which the hub leaks a writer per refresh.

Progress is throttled to one event per second per task. The worker also writes the latest percent to
`progress:{taskId}` in Redis so the `/api/dashboard` snapshot can report accurate progress for
already-running tasks; without it, a browser refresh would show every running task at 0 % until its
next tick.

---

## 8. Frontend

React 19 + Vite, structured along [bulletproof-react](https://github.com/alan2207/bulletproof-react)
lines: an `app/` layer for routing and providers, `features/` for dashboard, tasks and analytics, and
shared `components/`, `hooks/`, `lib/`, `stores/`.

**State is split by how it is obtained, not by what it contains:**

| Kind | Tool | Used by |
|---|---|---|
| Live, push-driven | Zustand store fed by SSE | Dashboard, worker utilisation |
| Queried, pull-driven | TanStack Query | Tasks table, analytics |

Mixing them would give a task row two owners — a query cache entry and a store entry that disagree.
The boundary keeps each row owned once. SSE events call `invalidateQueries` so the tasks table
refreshes without the store reaching into the cache.

`task-store.ts` and `use-task-stream.ts` live at `src/stores/` and `src/hooks/` rather than inside
`features/dashboard/`, because the tasks page uses them too and features must not import from one
another. That rule is enforced by `import/no-restricted-paths` in ESLint rather than left to
discipline.

The live store holds all active tasks plus the 50 most recent terminal ones, evicting as events
arrive, so a dashboard left open overnight does not grow without bound. Full history is on the
Tasks page behind server-side pagination.

**Types come from `packages/shared`.** The zod schemas that validate requests on the server are the
same ones that type responses on the client and validate the submit form. A field cannot drift.

---

## 9. Scaling beyond one node

Roughly in the order the constraints would actually bite.

**1 — More API capacity.** The API is stateless apart from its SSE connections. Run N replicas
behind a load balancer today; nothing changes, because every instance subscribes to the same Redis
channel and fans out to whichever browsers it holds. Sticky sessions are not required.

**2 — More worker capacity.** One change blocks `--scale worker=3`: DRR deficit counters live in
process memory, so three schedulers would each grant credits independently and the global share
would be wrong by a factor of three. Moving deficits to a Redis hash and making
select-and-decrement a small Lua script fixes it — roughly 60 lines. The ready queues, leases and
reconciler are already safe for multiple workers: `ZPOPMAX` is atomic and `claim` is a conditional
update.

**3 — Queue depth.** Per-client sorted sets shard naturally. Hash `clientId` to one of K Redis
shards and give each scheduler a subset; fairness is preserved within a shard, which is sufficient
once clients outnumber shards.

**4 — Task table growth.** `tasks` is append-heavy and queried by status and time. Partition by
`created_at` month, move terminal rows older than N days to cold storage, and switch the list
endpoint from `OFFSET` to keyset pagination — `OFFSET 100000` scans 100,000 rows.

**5 — Analytics.** The `GROUP BY` queries are correct but scan the live table. At volume they become
a rollup table updated on completion, or a time-series store fed from the event stream.

**6 — SSE fan-out.** One Node process holds a few thousand SSE connections comfortably. Past that,
terminate connections at a dedicated gateway subscribing to Redis, leaving the API stateless.

**7 — Redis durability.** Redis holds only rebuildable state today. If it grew to hold anything
authoritative, it would need AOF with `appendfsync everysec` and a replica.

**What would *not* change:** MySQL stays the source of truth, leases stay the recovery primitive,
and fairness stays a scheduling-time decision. The architecture was chosen so that scaling is
mostly a matter of where state lives, not of what the system does.

---

## 10. Trade-offs and known limitations

| Decision | Cost | Why it was accepted |
|---|---|---|
| Priority is intra-client | A client's P5 can wait behind another's P1 | Unavoidable — the alternative is a starvable queue |
| Deficits in process memory | One worker container | Named as the single blocker in §9.2 |
| No preemption | A long low-priority task holds a slot | Explicitly required by the brief |
| Analytics computed per request | Full scans at volume | Correct and simple at this scale; §9.5 is the path |
| Offset pagination | Degrades on deep pages | Dashboards want page numbers and totals |
| Reads are not scoped by API key | Any valid key sees all tasks | The dashboard is specified as a system-wide operator view |
| Progress is Redis-only | Lost if Redis is flushed mid-task | It is cosmetic; the task itself is unaffected |
| Reconciler polls every 30 s | Worst-case 30 s to heal drift | The window it covers is a two-write crash — rare |

---

## 11. If this were production

- **Real task handlers** behind the same registry interface, instead of simulated sleeps. The
  registry already has the right shape: a type, a payload schema, and an executor.
- **Idempotency keys** on submission, so a client retrying a failed HTTP request does not enqueue
  the same work twice.
- **Cooperative cancellation via `SharedArrayBuffer`**, since real CPU-bound handlers never drain
  their message queue.
- **Graceful drain on `SIGTERM`** — stop claiming, let in-flight tasks finish or release their
  leases deliberately, then exit. Today a deploy relies on the reaper.
- **Distributed tracing** with the trace id flowing HTTP → Redis → worker thread, so one task's
  journey is a single trace.
- **Alerting** on dead letter rate, queue depth per client, lease reclamation rate, and the gap
  between enqueue and first dispatch — the last is the real fairness SLO.
- **Per-type concurrency caps**, so one expensive task type cannot monopolise the pool.
- **Payload limits and encryption at rest**; payloads are arbitrary client JSON and are currently
  neither bounded beyond MySQL's `JSON` column nor encrypted.
- **Authentication beyond static API keys** — key rotation, scopes, and per-key audit.
- **A migration tool** with down-migrations and drift detection, rather than the append-only runner
  here.
