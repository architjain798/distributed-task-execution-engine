# web/AGENTS.md

React 19 + Vite dashboard. Structured on
[bulletproof-react](https://github.com/alan2207/bulletproof-react) lines, with the folder boundaries
enforced by ESLint rather than left to discipline.

Full playbook: [`../.agents/skills/add-a-frontend-feature.md`](../.agents/skills/add-a-frontend-feature.md).

## The governing decision

**State is split by how it is obtained, not by what it holds.** Live push-driven state lives in the
Zustand store fed by SSE; queried pull-driven state belongs to TanStack Query. Mixing them gives one
task row two owners that can disagree.

Do not patch query caches from SSE handlers — the stream calls `invalidateQueries` instead.

## Layout

```
app/          routing and providers. Composes features; features never compose each other.
components/   shared UI. Cannot import from features/.
features/     tasks/ · analytics/ · workers/
hooks/        use-task-stream.ts — the single EventSource for the whole app
lib/          api-client · react-query
stores/       task-store (live) · api-key-store
```

Anything two features need moves up to `stores/`, `hooks/` or `components/`. That is why
`task-store.ts` is not inside a feature.

kebab-case filenames. **No barrel files** — they defeat Vite's tree-shaking.

## Conventions that trip people up

Store actions and React props are declared as arrow properties, not method shorthand:
`onChange: (x) => void`, never `onChange(x): void`. Selectors pull them out as bare references, and
the shorthand form makes ESLint's `unbound-method` rule fire.

Types come from `@task-engine/shared` — the same zod schemas the server validates against. Never
hand-write a response type. If you change a shared schema, run
`npm run build -w @task-engine/shared` before typechecking.

The app always calls a relative `/api` path: Vite proxies it in dev, nginx in the container. There is
no base URL to configure.

Styling is one stylesheet (`src/styles.css`) with CSS custom properties; status colours are
`--status-<name>`. No CSS framework — do not add one for a single component.

## Bounded by design

The live store holds all active tasks plus the 50 most recent terminal ones, evicting as events
arrive, so a dashboard left open overnight stays bounded. Full history is the Tasks page behind
server-side pagination. Anything unbounded belongs in a query, not the store.

## Verifying

There are no frontend tests, so **open it**: `docker compose up -d --build`, then
http://localhost:8080. Press **Seed 60 tasks** and check the console is clean, the header shows
"Live", and progress bars move.
