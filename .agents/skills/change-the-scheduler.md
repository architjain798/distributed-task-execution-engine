# Changing the scheduler

The highest-risk area in the codebase. Fairness is the feature the whole design exists to deliver,
and it is easy to break in a way that still passes a smoke test.

**Read [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) §4 before editing anything here.**

## The guarantee you must not break

> No client can delay another client's work by submitting more of its own, at any priority.

Measured on the running system: while one client floods ten priority-5 tasks (≈15s of work), another
client's *lowest*-priority task starts in **263ms**. A global priority queue would make it wait the
full 15 seconds.

The deliberate cost is that **priority is intra-client**. Your priority 5 can wait behind my
priority 1. That is not a bug to fix — it is the only way to be unstarvable, and README.md says so
plainly. Do not "improve" it into a global priority queue.

## The files

| File | Responsibility |
|---|---|
| `engine/fair-scheduler.ts` | Which *client* dispatches next. Pure, no I/O. |
| `engine/ready-queue.ts` | Which *task* within that client. Redis ZSET + Lua. |
| `engine/dispatcher.ts` | The loop: pick client → pop task → claim in MySQL → run. |
| `engine/task-recovery.ts` | What a failed or crashed task becomes. |
| `engine/task-executor.ts` | Worker pool ownership, leases, stats. |

`FairScheduler` does no I/O on purpose — that is what makes the fairness tests pure and fast. Keep it
that way. If you need queue state there, pass it in.

## Invariants

**A client holds its turn only while it has credit.** That is what makes a weight of 2.5 mean 2.5x
the dispatch rate rather than rounding to 2 or 3. Remove the hold and weights silently stop working
while every test that only checks uniform weights still passes.

**Deficits reset when a queue empties.** Otherwise an idle client banks credit and bursts when it
returns, which is a different unfairness from the one we fixed.

**The ZSET score packs priority and age into one float**
(`priority * 1e13 - enqueuedAtMs`). One `ZPOPMAX` then gives "highest priority, oldest first"
atomically. Change the multiplier and priority bands start overlapping — `ready-queue.test.ts` covers
exactly this, including the worst case.

**`claim()` is a conditional `UPDATE ... WHERE status = 'queued'`.** This is the only thing preventing
a cancelled task from being dispatched. The database arbitrates the race; do not replace it with a
read-then-write.

**Pop and de-register must stay atomic.** `ready-queue.ts` uses Lua because as two round trips, an
enqueue landing in between would be de-registered and the task would sit invisible until the
reconciler found it 30 seconds later.

**Deficits are in worker process memory**, which is exactly why the system runs one worker container.
Moving them to a Redis hash is the documented path to `--scale worker=3` (README, scaling §2). If you
do that, select-and-decrement must become a single Lua script or two workers will dispatch for the
same client.

## Retry and recovery

`TaskRecovery.retryOrDeadLetter` is shared by the worker pool's crash handler and the lease reaper, so
they cannot disagree about what a lost task becomes. Change it in one place, and check both callers
still make sense.

- `attempts` increments at **claim** time, not on failure.
- Retried tasks re-enqueue at their **original** `enqueued_at`, keeping their queue position — they
  already waited once.
- A task in retry backoff is `queued` in MySQL and deliberately absent from Redis. The reconciler
  only touches rows untouched for 10s so it does not defeat the backoff.

## Testing

`server/tests/fair-scheduler.test.ts` is the specification. Every test name is a requirement. If you
change behaviour, change the test first and make sure it fails for the right reason.

The suite already covers: a flood not exceeding its share, a quiet client starting within one round,
2x and 2.5x weights, idle clients not banking credit, and full rotation.

## Verify on the running system

Unit tests prove the algorithm. They do not prove the loop, Redis, or the claim race. Run this:

```bash
docker compose up -d --build
curl -sX POST localhost:8080/api/dev/seed -H 'X-API-Key: acme-key-001'
```

Then watch the dashboard: tasks from all four clients must start interleaved, not in client order.
Acme submits 30 of the 60 tasks, all at priority 5 — if Acme's tasks drain first, fairness is broken.

For crash recovery:

```bash
curl -sX POST localhost:8080/api/dev/kill-worker -H 'X-API-Key: acme-key-001'
docker compose logs worker | grep -iE 'killing|exited|crash|retry'
```

Expect the chain: killing → exited → task lost to a crash → scheduled for retry. Then confirm the
pool returns to four threads via `GET /api/workers`.

Checking recovery by diffing a dashboard snapshot is racy — tasks start and finish constantly, so the
killed task may not be in your "before" set. Read the task id out of the worker log instead.
