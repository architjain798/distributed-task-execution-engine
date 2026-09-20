# Distributed Task Execution Engine

Clients submit long-running tasks. A pool of workers executes them under a fairness policy that no
single client can game, and browsers watch the whole thing move in real time.

```
docker compose up --build
```

Then open **http://localhost:8080** and press **Seed 60 tasks**.

> **One deviation from the brief:** the frontend is **React** rather than Angular, agreed in advance.
> Everything else follows the specification.

---

## Contents

- [Running it](#running-it)
- [What to look at first](#what-to-look-at-first)
- [Architecture](#architecture)
- [Fairness](#fairness-the-main-event)
- [Crash recovery](#crash-recovery)
- [Scaling beyond one node](#scaling-beyond-one-node)
- [Trade-offs and shortcuts](#trade-offs-and-shortcuts)
- [If this were production](#if-this-were-production)
- [API](#api)
- [Development](#development)

---

## Running it

`docker compose up --build` brings up five containers and needs no configuration. Cold start from an
empty volume takes about 15 seconds.

| Service | Purpose | Port |
|---|---|---|
| `web` | nginx serving the React bundle, proxying `/api` | **8080** |
| `api` | Express — routes, SSE, rate limiting, migrations | 3000 |
| `worker` | scheduler, worker threads, lease reaper, reconciler | — |
| `mysql` | source of truth | — |
| `redis` | ready queues, live progress, rate limits, pub/sub | — |

`api` and `worker` are **the same image with a different command**. They share every line of source.

### Seeded clients

Pick one in the header to act as that client. Weights are a database column.

| Client | API key | DRR weight |
|---|---|---|
| Acme | `acme-key-001` | 1.0 |
| Globex | `globex-key-002` | 1.0 |
| Initech | `initech-key-003` | **2.0** |
| Umbrella | `umbrella-key-004` | 1.0 |

`initech` is deliberately weighted 2.0 so the scheduler runs with non-uniform weights rather than
degenerating into plain round robin.

---

## What to look at first

Four things, in the order that shows the most.

**1 — Fairness under a flood.** Press **Seed 60 tasks**. Acme submits 30 tasks at priority 5; the
other three submit 30 between them at mixed priorities. Watch the dashboard: Globex, Initech and
Umbrella tasks start immediately, interleaved with Acme's, instead of queueing behind all 30.

Measured directly against the running system:

```
Acme floods 10 x priority-5 tasks (6s each, 4 workers => ~15s of work)
Globex then submits ONE task at priority 1, the lowest

  Globex's task started after 263ms
  A single global priority queue would have made it wait ~15,000ms
```

**2 — Crash recovery.** Press **Kill a worker thread**. A busy thread is killed mid-task. The task is
requeued within milliseconds, its attempt counter goes up, and the pool respawns a replacement:

```
RECOVERED  task 9ad88a91  attempts 1 -> 2  status=running  err="Worker thread exited with code 1"
worker pool after kill: {"total":4,"busy":4,"idle":0}
```

Try the harder version too — `docker compose stop worker` while tasks are running. Nothing inside a
dead process can report its own death, so the **lease reaper** in the restarted process picks the
tasks up. `docker compose start worker` and they resume.

**3 — Dead letter and retry.** Submit a task with `"failureRate": 1` in the payload. It fails four
times (one attempt plus three retries, with 1s/2s/4s backoff) and lands in the dead letter column with
its last error. Press **Retry** to send it back to the queue with a fresh budget.

**4 — Rate limiting.** Submit 11 tasks inside a minute as one client. The eleventh returns `429` with
`Retry-After`; a different client is unaffected.

---

## Architecture

Five containers. [`ARCHITECTURE.md`](./ARCHITECTURE.md) has the full detail; this is the shape.

```
                        ┌──────────────────────────────┐
   browser ─ HTTP ────▶ │  api            (node, 3000) │
           ◀─ SSE ───── │  routes · controllers        │
                        │  auth · rate limit · SSE hub │
                        └───┬──────────────────────┬───┘
                            │                      │  SUB channel:events
               read + write │                      │  PUB channel:control
                task state  ▼                      ▼
                  ┌──────────────────┐   ┌──────────────────┐
                  │      MySQL       │   │      Redis       │
                  │  source of truth │   │   fast index     │
                  └──────────────────┘   └──────────────────┘
                            ▲                      ▲
                write state │                      │  ZPOPMAX · HSET
                 transitions│                      │  PUB channel:events
                        ┌───┴──────────────────────┴───┐
                        │  worker                      │
                        │  dispatcher · fair scheduler │
                        │  worker_threads pool (N=4)   │
                        │  lease reaper · reconciler   │
                        └──────────────────────────────┘
```

### Key decisions

| Decision | Choice | Why |
|---|---|---|
| Source of truth | **MySQL** | Redis holds only state that can be rebuilt from it |
| Ready queue | **Redis ZSET per client** | `ZPOPMAX` is atomic; cancelling a queued task is one `ZREM` |
| Fairness | **Deficit Round Robin over per-client queues** | A flood fills only its own queue |
| Topology | **`api` + `worker`, one codebase** | Makes Redis load-bearing and crash recovery demonstrable |
| Worker isolation | **`worker_threads`** | Cheap to spawn; `exit` is an unambiguous crash signal |
| Concurrency limit | **pool size** | One task per thread; `WORKER_COUNT` is the limit |
| Cancellation | **cooperative, `terminate()` after 2s** | No leaked threads, no killed work that cannot be interrupted |
| Crash recovery | **`exit` handler + lease reaper + reconciler** | Three mechanisms, one failure mode each |
| Rate limiting | **Redis sliding-window log** | A fixed window allows 2x the limit across a boundary |
| Realtime | **one SSE stream, snapshot on connect** | Reconnect refetches; no event log to maintain |
| Analytics | **SQL `GROUP BY` per request** | Correct and simple at this scale |
| Types | **zod schemas in `packages/shared`** | The API and the browser cannot disagree about a field |

**The rule everything else follows:** *MySQL is the contract, Redis is an optimisation.* Flush Redis
entirely and the system repairs itself within 30 seconds. Lose MySQL and the system is lost.

### Repository layout

```
packages/shared/   zod schemas — the wire format, shared by server and web
server/src/
  app.ts · server.ts · worker.ts   app builder + two entrypoints
  container.ts                     composition root: the only place anything is constructed
  routes/ controllers/ services/ repositories/ middlewares/
  engine/                          dispatcher · fair-scheduler · ready-queue · worker-pool
                                   task-runner · lease-reaper · reconciler · task-recovery
  events/                          event-bus (Redis pub/sub) · sse-hub
web/src/
  app/ components/ features/ hooks/ lib/ stores/
```

The backend is layered: **routes** map URLs, **controllers** touch `req`/`res`, **services** hold
logic and never import Express, **repositories** hold SQL and never import services. `engine/` and
`events/` are domain modules rather than layers, because a background execution engine does not fit
the CRUD shape.

The frontend follows [bulletproof-react](https://github.com/alan2207/bulletproof-react): an `app/`
layer, `features/` modules, kebab-case filenames and no barrel files.

**State on the client is split by how it is obtained, not by what it holds.** Live, push-driven state
(the dashboard, progress bars, worker utilisation) lives in a Zustand store fed by SSE. Queried,
pull-driven state (the tasks table, analytics) belongs to TanStack Query. Mixing them would give one
task row two owners that could disagree.

Express 5 forwards rejected promises to the error middleware natively, so there is **no
`asyncHandler` wrapper and no `try/catch` in any controller** — and exactly one place in the codebase
writes an HTTP status code.

---

## Fairness: the main event

The brief asks for two things that cannot both be true:

> Tasks execute based on priority — higher priority tasks are dequeued before lower ones.

> No single client should be able to starve others by flooding the queue with high-priority tasks.

A single global priority queue satisfies the first and fails the second: a client submitting an
endless stream of priority-5 work blocks everyone else forever. Something has to give, and the design
decision is **which**.

### What I chose

**Priority is intra-client.** Each client gets its own Redis sorted set. The scheduler never looks at
a global ordering — it picks a **client** first, then pops that client's highest-priority task.

```
  submissions ──▶ queue:acme     [P5 P5 P5 P5 P5 P5 P5 …]  ──┐
                  queue:globex   [P2 P1]                    ──┼──▶ DRR picks the CLIENT
                  queue:initech  [P4]                       ──┘            │
                                                                           ▼
                                          ZPOPMAX on that one queue ──▶ worker
```

Each active client carries a **deficit counter**. It earns `weight` credits when its turn comes round
and spends one per dispatch, keeping the turn while credit remains. A client whose queue empties has
its deficit reset, so idle clients cannot bank credit and burst later.

### Why DRR rather than the alternatives

- **Weighted Fair Queueing** with virtual finish times is the more sophisticated answer and would let
  priority influence ordering *across* clients. It is also materially harder to read and to verify by
  inspection, and the virtual-time bookkeeping is exactly the kind of subtlety that hides bugs.
- **A global priority queue with per-client concurrency caps and priority aging** keeps global
  priority semantics, but it is a bundle of heuristics rather than a named scheduling discipline, and
  the aging constants would be unjustifiable.
- **Plain round robin** is what DRR reduces to at uniform weights — but then client weighting is a
  rewrite rather than a configuration change.

### The trade-offs, stated plainly

- **A client's priority-5 task can wait behind another client's priority-1 task.** This is the direct
  cost of not being starvable, and it is the right trade for a multi-tenant system. A single-tenant
  batch system should make the opposite choice.
- **DRR meters dispatches, not time.** A client submitting many short tasks gets more *dispatches*
  than one submitting few long ones. Fair by admission, not by CPU-seconds. Charging the deficit by
  observed execution time would fix this and is roughly forty lines; it was not worth the added
  feedback complexity here.
- **No preemption.** The brief requires that a running low-priority task is never killed, so fairness
  is enforced only at dequeue time. A burst of long tasks can therefore hold workers for a while.
- **Deficits live in worker process memory**, which is what limits the system to one worker container
  today. See below.

### Rate limiting is a separate concern

Fairness governs *scheduling*; rate limiting governs *admission*. Each client may submit 10 tasks per
minute, enforced by a Redis sorted set used as a sliding-window log — `ZREMRANGEBYSCORE`, `ZCARD`,
`ZADD` and `PEXPIRE` in one `MULTI`.

A **fixed window** would have been three lines shorter and allows 20 submissions across a boundary
(ten at 11:59:59, ten at 12:00:00) — precisely what anyone probing a rate limiter tries first. A
**token bucket** smooths bursts but introduces a burst parameter that "max 10 per minute" gives no
basis to choose.

---

## Crash recovery

Three mechanisms. Each covers exactly one failure mode, and each is simple *because* none of them
tries to cover everything.

| Mechanism | Period | Covers |
|---|---|---|
| `worker.on('exit')` | instant | a worker thread dying mid-task |
| Lease reaper | 10s | the whole worker container dying |
| Reconciler | 30s | MySQL and Redis disagreeing |

**Leases.** Every running task holds `lease_expires_at`, set 60s ahead at claim time and renewed
every 15s while it runs. A reaper sweeps expired leases and requeues what it finds. Nothing inside a
process can report that process's own death, which is why the in-process `exit` handler is not enough
on its own.

**The reconciler** is the one that is easy to skip and shouldn't be. Submitting a task writes to two
systems: `INSERT` into MySQL, then `ZADD` into Redis. A crash between them leaves a task `queued` in
the database and absent from the queue — invisible to the dispatcher forever. Choosing Redis as the
queue *narrowed* that window; it did not close it. The reconciler closes it, and doubles as the
repair path if Redis is flushed.

**Retry policy.** Retryable failures and crashes retry to four attempts total with 1s/2s/4s backoff,
then dead-letter. Fatal failures — unknown task type, a payload that fails its schema — never retry.

That distinction is why `failed` and `dead_letter` are separate states rather than two names for one
thing: `failed` means *this task can never succeed*, `dead_letter` means *the work was legitimate and
we could not complete it*.

---

## Scaling beyond one node

Roughly in the order the constraints would actually bite.

**1 — API capacity.** The API is stateless apart from its SSE connections. Run N replicas behind a
load balancer today, unchanged: every instance subscribes to the same Redis channel and fans out to
the browsers it holds. No sticky sessions required.

**2 — Worker capacity.** Exactly one thing blocks `docker compose up --scale worker=3`: **DRR deficit
counters live in process memory**, so three schedulers would each grant credits independently and the
global share would be wrong by a factor of three. Moving deficits to a Redis hash and making
select-and-decrement a small Lua script fixes it — roughly 60 lines. Everything else is already
multi-worker safe: `ZPOPMAX` is atomic, and `claim` is a conditional `UPDATE … WHERE status='queued'`
that exactly one worker can win.

**3 — Queue depth.** Per-client sorted sets shard naturally. Hash `clientId` across K Redis shards
and give each scheduler a subset; fairness holds within a shard, which is sufficient once clients
outnumber shards.

**4 — Task table growth.** `tasks` is append-heavy and queried by status and time. Partition by
`created_at` month, move terminal rows to cold storage after N days, and switch the list endpoint
from `OFFSET` to keyset pagination — `OFFSET 100000` scans 100,000 rows to discard them.

**5 — Analytics.** The `GROUP BY` queries scan the live table. At volume they become rollup tables
updated on completion, or a time-series store fed from the event stream.

**6 — SSE fan-out.** One Node process holds a few thousand SSE connections comfortably. Past that,
terminate them at a dedicated gateway subscribing to Redis, leaving the API fully stateless.

**7 — Redis durability.** Redis holds only rebuildable state today, so it needs no persistence. If it
ever held anything authoritative it would need AOF with `appendfsync everysec` and a replica.

**What would not change:** MySQL stays the source of truth, leases stay the recovery primitive, and
fairness stays a scheduling-time decision. The architecture was chosen so that scaling is mostly a
question of *where state lives*, not of what the system does.

---

## Trade-offs and shortcuts

| Shortcut | Consequence | Why it was acceptable |
|---|---|---|
| Priority is intra-client | A client's P5 can wait behind another's P1 | Unavoidable — the alternative is a starvable queue |
| Deficits in process memory | One worker container | The single named blocker in the scaling section |
| No preemption | A long low-priority task holds a slot | Explicitly required by the brief |
| Reads are not scoped by API key | Any valid key sees all tasks | The dashboard is specified as a system-wide operator view |
| Analytics computed per request | Full scans at volume | Correct and simple at 60 tasks |
| Offset pagination | Degrades on deep pages | A dashboard wants page numbers and totals |
| Progress lives only in Redis | Lost if Redis is flushed mid-task | Cosmetic; the task itself is unaffected |
| Dispatcher polls every 200ms | Up to 200ms submit-to-start latency | Removes a whole class of wakeup bugs for imperceptible cost |
| `/api/dev/*` enabled by default | Seeding and worker-killing are open | Demo affordances; `ENABLE_DEV_ROUTES=false` turns them off |
| Append-only SQL migrations | No down-migrations, no drift detection | A real project would use a migration tool |
| `cors()` is permissive | Any origin may call the API | In the container everything is same-origin via nginx |
| No graceful drain on `SIGTERM` | A deploy relies on the reaper | Correct but slow; see below |

---

## If this were production

- **Real task handlers** behind the existing registry interface, which already has the right shape: a
  type, a payload schema and an executor.
- **Idempotency keys on submission**, so a client retrying a failed HTTP request does not enqueue the
  same work twice.
- **`SharedArrayBuffer` cancellation.** Cooperative cancellation works here only because the
  simulated work sleeps between ticks and its message queue drains. A real CPU-bound handler would
  never see the message; it needs an `Atomics`-backed flag.
- **Graceful drain on `SIGTERM`** — stop claiming, let in-flight tasks finish, release leases
  deliberately, then exit.
- **Distributed tracing**, with the trace id flowing HTTP → Redis → worker thread so one task's
  journey is a single trace.
- **Alerting** on dead letter rate, per-client queue depth, lease reclamation rate, and the gap
  between enqueue and first dispatch — that last one is the real fairness SLO.
- **Per-type concurrency caps**, so one expensive task type cannot monopolise the pool.
- **Payload limits and encryption at rest.** Payloads are arbitrary client JSON, currently bounded
  only by the request size limit.
- **Auth beyond static API keys** — rotation, scopes, per-key audit.

---

## API

Every route requires `X-API-Key`. `/api/events` also accepts `?apiKey=` because the browser's
`EventSource` cannot set headers.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/tasks` | `{type, priority, payload}` → 201. Rate limited. |
| `GET` | `/api/tasks` | `?status&type&priority&from&to&search&page&pageSize` |
| `GET` | `/api/tasks/:id` | |
| `POST` | `/api/tasks/:id/cancel` | 409 if already terminal |
| `POST` | `/api/tasks/:id/retry` | Dead-lettered tasks only; 409 otherwise |
| `GET` | `/api/dashboard` | Active tasks + 50 most recent terminal + worker stats |
| `GET` | `/api/events` | SSE: `task.created`, `task.updated`, `task.progress`, `workers.stats` |
| `GET` | `/api/analytics` | `?minutes=60` |
| `GET` | `/api/workers` | Pool utilisation |
| `GET` | `/api/health` | Unauthenticated; reports MySQL and Redis |
| `POST` | `/api/dev/seed` | 60 tasks across four clients |
| `POST` | `/api/dev/kill-worker` | Kills a busy thread to demonstrate recovery |

### Task types

Profiles differ deliberately, so analytics shows real variance and the dead letter queue populates on
its own. `payload.durationMs` and `payload.failureRate` override them.

| Type | Duration | Failure rate |
|---|---|---|
| `image-processing` | 5–12s | 5% |
| `report-generation` | 15–30s | 10% |
| `data-import` | 8–20s | 20% |
| `email-batch` | 5–10s | 2% |

---

## Development

```bash
npm install
npm run build -w @task-engine/shared   # both sides depend on this

docker compose up -d mysql redis
npm run dev:api        # :3000
npm run dev:worker
npm run dev:web        # :5173, proxies /api to :3000
```

### Checks

```bash
npm run check          # typecheck + lint + format:check + test, in that order

npm run typecheck      # tsc --noEmit across all three workspaces, tests included
npm run lint           # eslint
npm run lint:fix       # eslint --fix
npm run format         # prettier --write
npm test               # 24 unit tests
npm run seed           # same service the seed endpoint uses
```

ESLint is type-aware (`recommendedTypeChecked`), so `no-floating-promises` and
`no-misused-promises` actually apply — worth having in a codebase full of timers, worker threads and
background sweeps.

It also enforces the two architectural boundaries this README describes, rather than leaving them to
discipline:

- **Server layering.** Repositories cannot import services, services cannot import controllers or
  routes, and nothing below the controllers may import `express`. Put a file in the wrong folder and
  the lint fails.
- **Frontend feature isolation.** `features/tasks`, `features/analytics` and `features/workers`
  cannot import from one another, and shared `components/` cannot import from any feature. Features
  are composed at the app layer.

Each workspace has two TypeScript configs: `tsconfig.json` checks everything including tests and
emits nothing, and `tsconfig.build.json` emits `dist/` from `src` only. The editor, ESLint and
`typecheck` all resolve to the first; only `npm run build` uses the second.

### Tests

Focused on the parts the brief calls out — worker recovery, queue ordering and fairness — rather than
coverage. Fakes for MySQL and Redis keep the suite under a second.

```
tests/fair-scheduler.test.ts   flooding, weighting, fractional weights, idle clients cannot bank credit
tests/task-recovery.test.ts    retry vs dead-letter, backoff, queue position preserved across retries
tests/rate-limiter.test.ts     exact limit, window boundary burst, per-client isolation
tests/ready-queue.test.ts      priority beats age, FIFO within a priority, no band overlap
```

### Configuration

Every value has a working default; see [`.env.example`](./.env.example).

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_COUNT` | `4` | Threads in the pool, and the concurrency limit |
| `RATE_LIMIT_MAX` | `10` | Submissions per client per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window length |
| `ENABLE_DEV_ROUTES` | `true` | Seeding and the worker kill switch |
| `LOG_LEVEL` | `info` | pino level; logs are JSON on stdout |
