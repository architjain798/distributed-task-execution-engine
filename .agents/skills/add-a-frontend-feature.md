# Frontend changes

React 19 + Vite, structured on [bulletproof-react](https://github.com/alan2207/bulletproof-react)
lines. ESLint enforces the folder boundaries, so `npm run check` tells you if a file is in the wrong
place.

## The decision that governs everything

**State is split by how it is obtained, not by what it holds.**

| Kind | Tool | Used by |
|---|---|---|
| Live, push-driven | Zustand store fed by SSE | Dashboard, progress bars, worker utilisation |
| Queried, pull-driven | TanStack Query | Tasks table, analytics |

Mixing them gives one task row two owners that can disagree. Before adding state, decide which kind
it is:

- Does it arrive over SSE and need to update without a request? → `stores/task-store.ts`
- Is it fetched, filtered or paginated by the server? → a `useQuery` in `features/*/api/`

Do not patch query caches from SSE handlers. The stream calls `invalidateQueries` and lets React
Query refetch; that keeps each row owned once.

## Where files go

```
app/          routing, providers. Composes features; features never compose each other.
components/   shared UI. May not import from features/ (ESLint enforces this).
features/     tasks/ · analytics/ · workers/ — each with api/ and components/
hooks/        shared hooks. use-task-stream.ts lives here because two features need it.
lib/          api-client, react-query config
stores/       zustand. task-store is here, not in a feature, because two features read it.
```

**If two features need something, it moves up** to `stores/`, `hooks/` or `components/` — it does not
get imported across the feature boundary. That rule is why `task-store.ts` and `use-task-stream.ts`
are not inside `features/dashboard/`.

Filenames are kebab-case. **No barrel files** — they defeat Vite's tree-shaking. Import directly.

## Adding a queried view

1. `features/<name>/api/get-thing.ts` — a `useQuery` calling `apiFetch<T>` with a key from
   `lib/react-query.ts`
2. `features/<name>/components/*.tsx` — presentational, props in
3. `app/routes/<name>.tsx` — composes them
4. `app/router.tsx` — the route

Types come from `@task-engine/shared`. Never hand-write a response type; if the shape is missing,
add it to the shared schemas so the server validates against the same definition.

## Adding live state

Extend the event union in `packages/shared/src/event.schema.ts`, handle it in `task-store.ts`'s
`applyEvent`, and add the event name to `EVENT_TYPES` in `hooks/use-task-stream.ts`. The server side
publishes through `EventBus`.

Keep the store bounded. It holds all active tasks plus the 50 most recent terminal ones and evicts as
events arrive, so a dashboard left open overnight does not grow without limit. Anything unbounded
belongs in a paginated query instead.

## Conventions

Store actions are declared as arrow properties, not method shorthand — selectors pull them out as
bare references, and shorthand makes `unbound-method` fire. Same for React props:
`onChange: (x) => void`, not `onChange(x): void`.

Styling is one hand-written stylesheet (`src/styles.css`) with CSS custom properties. Status colours
come from `--status-<name>` variables so the palette lives in one place. There is no CSS framework;
do not add one for a single component.

The app always calls a relative `/api` path — Vite proxies it in development, nginx in the container.
There is no base URL to configure.

## Verify

```bash
npm run check
docker compose up -d --build   # then open http://localhost:8080
```

Unit tests do not cover the frontend, so **look at it**. Check the browser console is clean, the SSE
connection shows "Live" in the header, and progress bars actually move after pressing
**Seed 60 tasks**.
