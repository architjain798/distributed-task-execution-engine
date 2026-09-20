# Adding a task type

The most common extension. A task type is a name, a payload schema, a duration profile and a failure
probability — all four live in one file.

## Where it goes

**`server/src/engine/task-type.registry.ts`** holds the profiles.
**`packages/shared/src/task.schema.ts`** holds `TASK_TYPES`, which the frontend's type dropdown and
filters read.

Both must be updated. The registry is the authority at runtime; the shared list is what the browser
offers.

## Steps

1. Add the name to `TASK_TYPES` in `packages/shared/src/task.schema.ts`.
2. Add a profile to `PROFILES` in `task-type.registry.ts`:

```ts
'video-transcode': {
  name: 'video-transcode',
  minDurationMs: 20_000,
  maxDurationMs: 60_000,
  failureRate: 0.15,
  payloadSchema: payloadSchema({
    sourceUrl: z.string().max(500).optional(),
    codec: z.string().max(32).optional(),
  }),
},
```

3. `npm run build -w @task-engine/shared` so the frontend sees the new name.
4. `npm run check`.

## Things to get right

**Use the `payloadSchema()` helper, not a bare `z.object()`.** It folds in the `durationMs` and
`failureRate` override fields that every type accepts. Without them, tests cannot be deterministic
and a reviewer cannot force a failure on demand.

**Give it a distinct duration and failure rate.** The existing four differ on purpose: identical
profiles would make "average execution time by type" four identical bars and the dead letter queue
would never populate without someone forcing it. A new type that mirrors an existing one adds
nothing to the demo.

**Payload fields should be optional.** Submission validates the payload against this schema and
raises `FatalError` on a mismatch, which sends the task straight to `failed` with no retries. Required
fields turn a typo into a dead task rather than a defaulted one.

**Do not add an executor.** Work is simulated by sleeping in `task-runner.ts`; the profile is the
whole behaviour. If you are adding *real* execution, that is a different change — the registry
already has the right shape for it (a type, a schema, and somewhere to hang an executor), and
README.md lists it under production notes.

## Verify

```bash
npm run build -w @task-engine/shared && npm run check
docker compose up -d --build

curl -sX POST localhost:8080/api/tasks \
  -H 'X-API-Key: acme-key-001' -H 'Content-Type: application/json' \
  -d '{"type":"video-transcode","priority":3,"payload":{"durationMs":2000}}'

# a bad payload must be rejected at submission, not at execution
curl -sX POST localhost:8080/api/tasks \
  -H 'X-API-Key: acme-key-001' -H 'Content-Type: application/json' \
  -d '{"type":"video-transcode","priority":3,"payload":{"codec":123}}'
# expect 400 FATAL_TASK_ERROR

# forcing a dead letter
curl -sX POST localhost:8080/api/tasks \
  -H 'X-API-Key: acme-key-001' -H 'Content-Type: application/json' \
  -d '{"type":"video-transcode","priority":5,"payload":{"durationMs":300,"failureRate":1}}'
# poll GET /api/tasks/:id — expect dead_letter at attempts 4/4
```

Then check the new type appears in the submit form's dropdown and as its own bar on the Analytics
page.
