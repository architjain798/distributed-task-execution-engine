# Adding an API endpoint

Five layers, built bottom-up. ESLint enforces the direction of dependency, so building in this order
passes at every step; building top-down fails until the last file lands.

```
routes/  →  controllers/  →  services/  →  repositories/  →  MySQL
   URL         req/res         logic           SQL
```

## Order

**1. Repository** (`server/src/repositories/*.repository.ts`) — if you need new data.

One method, one parameterised query. Repositories may not import services, controllers, routes or
the engine. Map rows to domain shapes with a small function; do not return `RowDataPacket` upwards.

**2. Shared schema** (`packages/shared/src/*.schema.ts`) — if the response shape is new.

Declare it as zod and export `z.infer` for the type. The browser gets the same definition, so a
field cannot drift between the two. Rebuild with `npm run build -w @task-engine/shared`.

**3. Service** (`server/src/services/*.service.ts`) — the logic.

Services never import `express` (ESLint blocks it) and never touch `req`/`res`. They take values and
return values, and throw typed errors from `utils/errors.ts`. This is where a decision belongs — a
controller with an `if` in it is a controller doing a service's job.

**4. Controller** (`server/src/controllers/*.controller.ts`) — the translation.

```ts
export function createThingController(things: ThingService) {
  return {
    get: async (req: Request, res: Response): Promise<void> => {
      const { id } = validated<ThingParams>(req, 'params');
      res.json(await things.getById(id));
    },
  };
}
```

Arrow properties, not method shorthand — these are standalone handlers, and the shorthand form makes
ESLint's `unbound-method` rule fire when they are passed to a route. No `try/catch`: Express 5
forwards rejections to the error middleware.

**5. Route** (`server/src/routes/*.routes.ts`) — the URL.

```ts
router.get('/:id', validate({ params: thingParamsSchema }), controller.get);
```

Routes contain no logic. If a route file grows a condition, that condition belongs in a service.

**6. Wire it** in `container.ts` (construct the service) and `routes/index.ts` (mount the router).
`container.ts` is the only place in the application that calls `new`.

## Validation

Put schemas for request *shape* (params, query strings) in `server/src/schemas/`. Put anything
describing a domain object in `packages/shared` so the browser shares it.

Read validated data through the helper, never off the request:

```ts
const input = validated<CreateTaskInput>(req, 'body');   // correct
const input = req.body;                                   // unvalidated, untyped
const page  = req.query.page;                             // Express 5 getter, bypasses validation
```

## Auth and rate limiting

`authMiddleware` runs for everything under `/api` except `/health`, so `req.client` is populated —
narrow it with `requireClient(req)`.

Rate limiting is applied per route, and deliberately only to submission. Do not add it to reads; the
dashboard polls them and limiting them breaks the UI without protecting anything.

Reads are intentionally not scoped by API key: the dashboard is specified as a system-wide operator
view. If you add a route that *should* be scoped, do it explicitly in the service and say so in
README.md's trade-offs table.

## Verify

```bash
npm run check
docker compose up -d --build
curl -s localhost:8080/api/your-route -H 'X-API-Key: acme-key-001'

# the error paths matter as much as the happy one
curl -so /dev/null -w '%{http_code}\n' localhost:8080/api/your-route            # 401, no key
curl -so /dev/null -w '%{http_code}\n' localhost:8080/api/your-route/not-a-uuid -H 'X-API-Key: acme-key-001'  # 400
```
