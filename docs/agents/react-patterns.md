# React Patterns

## Loading states — gate on `isPending`, never `isFetching`

The app's `queryClient` is `new QueryClient()` with no config, so it inherits TanStack's default `staleTime: 0`. Every remount fires a background revalidation with `isFetching === true`. Gating "we have no data yet" UI (skeletons, empty-state `disabled`) on `isFetching` therefore re-shows the skeleton on back-navigation to an already-cached page.

```typescript
const isLoading = !query.data || query.isFetching; // ❌ breaks back-nav
const isLoading = query.isPending; // ✅ true only until first successful fetch
```

`isPending` is the right gate (false during silent background revalidation; note it is also true while `enabled: false`). Use `isFetching` / `mutation.isPending` ONLY for in-flight affordances the user expects: disabling a Save button mid-mutation, a spinner on an explicit user-triggered refetch, per-row action state, or a "refreshing…" indicator next to a "last updated" timestamp.

## Exports & code splitting

Named exports only — no default exports. The lazy-import wrapper is therefore mandatory:

```typescript
lazy(() => import('./File').then((m) => ({ default: m.NamedExport })));
```

## Context provider

Use the context object directly as the provider — `<Context value={...}>`, not `<Context.Provider value={...}>`. (Vendored shadcn components under `components/ui/` still use `.Provider`; that's upstream code, leave it.)

## API layer — typed Hono RPC

Talk to the backend through the typed Hono RPC `client` export — not a REST wrapper or hand-rolled `fetch`.

- Call typed paths that mirror the server routes: `client.api.health.$get()`, `client.api.auth.verify.$post({ json: { email, code } })`. Paths already include `/api` (the server mounts under `.basePath('/api')`).
- The return value is a `fetch` `Response`: call `await res.json()` and check `res.ok` / `res.status`. A 503 resolves (not rejects) — only a network failure rejects.
- Bodies cross the wire as JSON, so a DB `Date` arrives as an ISO **string** (e.g. `AuthUser.createdAt`).
- Wrap all calls in `useQuery` / `useMutation`.

## Provider order (load-bearing)

In the app entry, outer → inner: `QueryClientProvider` → `BrowserRouter` → `ErrorBoundary` → `AuthProvider` → `App`. The order is not cosmetic:

- `ErrorBoundary` sits inside query + router so its fallback can use those hooks — but its fallback deliberately depends on neither auth nor a specific route, so it still renders if `AuthProvider` itself throws.
    - **Render-only limitation:** it catches errors thrown during render, not async errors, event-handler errors, or errors inside `useEffect`. Handle those at the call site — TanStack Query surfaces data-fetch errors (`isError`/`error`), and event handlers should try/catch and set local error state.
- `AuthProvider` sits inside `QueryClientProvider` because it resolves the session via TanStack Query.

Match this when adding providers.

## Auth / RBAC

Read auth via the `useAuth()` hook (`user` with `user.role`, `login`, `logout`, `isLoading`) — never hit the session endpoint directly from a component. The client check is UX only; the real gate is the server-side `requireAuth()` middleware + the ownership rule in the route handlers.

## Conventions

- Event handlers `handle<Action>` (`handleSignOut`); the prop they pass to is `on<Event>` (`onClick`).
- Annotate explicit return types on exported non-component functions (components are exempt — their JSX return is inferred).
- Default to NO memoization; add `useMemo`/`useCallback` only for a measured cost or to stabilize a value passed to a memoized child.
- Member order inside a component: hooks (custom → `useState` → `useContext` → `useRef`) → derived state → memo/callbacks (if any) → effects → `handle*` handlers → local helpers → JSX.
- `react-hooks/exhaustive-deps` is an ESLint **error** here, not a warning — fix the root cause, never suppress.
- Form validation: React Hook Form + Zod via `@hookform/resolvers/zod` — the `useForm({ resolver: zodResolver(schema) })` + shadcn `Form` pattern. Check `package.json` for the installed Zod major; the schema API shifts across majors.
- Styling lives in [`ui-components.md`](ui-components.md) (`cn()`, `cva`, tokens).

## Reference implementations (grep the symbol)

- App shell + nav: `Layout`
- Form (RHF + Zod + shadcn): the `Login` route
- Context + custom hook: `AuthProvider` / `useAuth`
- TanStack Query against the RPC client: the `Welcome` route
  </content>
