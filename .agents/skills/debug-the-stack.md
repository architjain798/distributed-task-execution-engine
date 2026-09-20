# Debugging the stack

## First moves

```bash
docker compose ps                                  # who is up, who is healthy
curl -s localhost:8080/api/health                  # names which dependency is down
docker compose logs --tail=50 api
docker compose logs --tail=50 worker
docker compose logs | grep '"level":"error"'       # should be empty
```

Logs are JSON on stdout at every level. `grep` for `taskId` to follow one task end to end across both
processes.

## Symptom → cause

**Tasks stay `queued` and nothing runs.**
The worker process is the dispatcher. `docker compose ps worker` — if it is down, nothing dispatches
and the API keeps accepting work happily. Restart it; the lease reaper reclaims anything that was
in flight. If the worker is up, check `GET /api/workers`: `updatedAt: null` means its heartbeat key
expired, so the process is wedged rather than merely idle.

**A task is `queued` in MySQL but never dispatches.**
It is missing from the Redis ready queue — the dual-write window. The reconciler repairs this within
30 seconds. If it does not, check `docker compose logs worker | grep reconciler`. Inspect directly:

```bash
docker compose exec redis redis-cli SMEMBERS clients:active
docker compose exec redis redis-cli ZRANGE queue:<clientId> 0 -1 WITHSCORES
```

**Progress bars sit at 0%.**
Progress lives in Redis, not MySQL. `docker compose exec redis redis-cli GET progress:<taskId>`. If
that has a value but the UI does not, the SSE stream is the problem, not the engine.

**The SSE stream delivers nothing.**
Test it with a raw HTTP client, not `fetch` — Node's `fetch` buffers the body and will show you an
empty stream on a perfectly working server. This cost real time once:

```bash
curl -N -s "localhost:8080/api/events?apiKey=acme-key-001"
```

Expect `: connected` within ~25ms, then events, and a `:heartbeat` every 15s. On an idle system you
will still see `workers.stats` every two seconds — that is the liveness signal.

Run it bare. Piping into `head` or `grep` reintroduces buffering and shows you an empty stream on a
working server, which is the same false negative as using `fetch`.

If it works on `:3000` but not `:8080`, nginx is buffering — check `proxy_buffering off` in
`web/nginx.conf`.

**Everything returns 401.**
The API key goes in `X-API-Key`. The SSE endpoint also accepts `?apiKey=` because the browser's
`EventSource` cannot set headers. Seeded keys: `acme-key-001`, `globex-key-002`, `initech-key-003`,
`umbrella-key-004`.

**Submissions return 429.**
Working as designed: 10 per minute per client. Use a different key, or wait for the window to slide.
`docker compose exec redis redis-cli ZCARD ratelimit:<clientId>` shows the current count.

**`docker compose up` fails on a port.**
Another stack is already bound to 3000 or 8080. `API_PORT=3100 WEB_PORT=8180 docker compose up -d`,
or stop the other one.

**The API crashes at boot.**
Environment is zod-parsed at startup and the process exits rather than running misconfigured — the
error names the offending variable. If it is a migration error instead, the statement is printed in
full; migrations are applied by the API only, and the worker waits on the API's health check.

## Inspecting state directly

```bash
# MySQL
docker compose exec mysql mysql -uroot -proot task_engine \
  -e "SELECT status, COUNT(*) FROM tasks GROUP BY status"
docker compose exec mysql mysql -uroot -proot task_engine \
  -e "SELECT id, type, status, attempts, last_error FROM tasks WHERE status='dead_letter' LIMIT 5"

# Redis
docker compose exec redis redis-cli KEYS 'queue:*'
docker compose exec redis redis-cli GET workers:stats
docker compose exec redis redis-cli PUBSUB NUMSUB channel:events channel:control
```

`PUBSUB NUMSUB` returning 0 subscribers means the api or worker lost its Redis subscription — the
usual cause of "events stopped arriving but everything looks healthy".

## Pitfalls when verifying

**Do not check crash recovery by diffing dashboard snapshots.** Tasks start and finish constantly, so
the killed task may not be in your "before" set and you will report a false regression. Take the task
id from the worker log instead:

```bash
curl -sX POST localhost:8080/api/dev/kill-worker -H 'X-API-Key: acme-key-001'
docker compose logs worker | grep 'deliberately killing'
curl -s localhost:8080/api/tasks/<id> -H 'X-API-Key: acme-key-001'
```

**A fresh seed does not clear old data.** `docker compose down -v` drops the MySQL volume; without
`-v` you keep every task from previous runs and your analytics numbers will include them.

**Give the reconciler and reaper time.** They run on 30s and 10s intervals. A test that waits 3
seconds and declares failure is testing its own patience.
