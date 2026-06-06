# Vibe Starter — Frontend Design

> Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui. Chosen for a modern, polished default aesthetic (it matters when you're building a consumer-facing product where customers form a snap judgment about whether the service looks trustworthy), copy-in components you own and can restyle, strong agent training data, and no proprietary or non-redistributable license — important for a public, MIT-licensed starter.

This document covers the frontend stack. For project-level decisions (audience, scope, distribution), see [`PROJECT_DESIGN.md`](./PROJECT_DESIGN.md). For backend, see [`BACKEND_DESIGN.md`](./BACKEND_DESIGN.md). For tooling (TypeScript, lint, test), see [`TOOLING_DESIGN.md`](./TOOLING_DESIGN.md).

---

## Decision summary

| Decision          | Choice                                                                                | Primary alternative considered       |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| Build tool        | **Vite**                                                                              | Next.js, Remix, Create React App     |
| UI framework      | **React 19**                                                                          | Vue, Svelte, Solid                   |
| Language          | **TypeScript**                                                                        | JavaScript                           |
| Component library | **shadcn/ui + Tailwind CSS v4**                                                       | MUI, Mantine, Chakra                 |
| Lists & tables    | **shadcn `Table`**; TanStack Table behind a `<DataTable>` wrapper as the escape hatch | MUI X DataGrid, AG Grid              |
| Charts            | **Not shipped** — reach for Recharts if a prototype needs them                        | Highcharts, ECharts, Chart.js, visx  |
| Theming           | **Tailwind config + CSS variables** (shadcn tokens), inline & freely editable         | Shared theme package                 |
| Routing           | **React Router v7**                                                                   | TanStack Router, Next.js file-based  |
| Forms             | **react-hook-form + zod** via shadcn `Form`                                           | Formik, raw `useState`               |
| Data fetching     | **TanStack Query** + Hono RPC client                                                  | SWR, raw `fetch`, RTK Query          |
| State             | **Local + Context** for cross-component                                               | Zustand, Redux, Jotai                |
| Payments UI       | **Stripe-hosted Checkout** (redirect)                                                 | Embedded Stripe Elements             |
| Mobile            | **Responsive only** (no PWA)                                                          | Installable PWA, separate mobile app |

---

## Build tool: Vite

### Decision

Use **Vite** as the build tool and dev server.

### Why

Vite is the de facto standard for modern React SPAs. Cold start in milliseconds, near-instant HMR, native ESM in dev, Rollup-based production builds. The agent ecosystem has saturated training data on Vite configurations. There is no friction here — choosing Vite is the obvious move.

### Alternatives considered

**Next.js (App Router).** A serious contender given its file-based routing, Server Components, and Server Actions. We ultimately rejected it for this starter because:

- **Railway is the deploy target**, not Vercel. On Railway, Next.js runs as `next start` in a single Node container, losing the per-route serverless-functions value proposition that Vercel offers. The remaining benefits (file-based routing, Server Components) are real but smaller.
- **Server vs Client Components is conceptual surface area** that adds complexity for a non-engineer. Even when the agent handles it correctly, when something breaks the human has to understand the boundary to debug it.
- **A separate Hono backend is preferable here.** Next.js's API routes / Server Actions partially compete with Hono. Picking Hono _and_ Next.js is awkward; picking Vite + Hono is clean.

We may revisit Next.js if a marketing-site shape (where SEO and SSR matter materially) becomes the dominant kind of project people build with the starter.

**Remix (React Router v7 framework mode).** Philosophically closer to "a React framework that runs as a server," which would match Railway well. Rejected for the same Server/Client conceptual-surface-area reason as Next.js, plus smaller community and less agent training data. Distinct from React Router v7 in library mode, which we do use for routing (see Routing section).

**Create React App (CRA).** Officially deprecated by the React team. Not a serious option in 2026.

### Trade-offs

We give up server-side rendering by default. For an app behind a login — like the customer-facing app in the representative bookings example — this doesn't matter (SEO is irrelevant; auth gates everything). For public marketing pages, we accept the trade — a Vite SPA that pre-renders public routes with a plugin like `vite-plugin-ssg` covers the 80% case without a Next.js runtime.

### When to revisit

If a marketing/SEO-heavy public site becomes the primary thing you're building, reconsider Next.js. If a future Vite plugin offers comparable Server Components ergonomics, reconsider then too.

---

## UI framework: React + TypeScript

### Decision

**React 19** with **TypeScript** in strict mode.

### Why

React is the most widely used UI library, with the deepest pool of agent training data and the largest ecosystem of components, examples, and answers. For a non-engineer leaning on an AI agent, that depth directly translates to fewer dead ends — the agent has seen the patterns it's writing thousands of times. React's component model is also the lingua franca that shadcn/ui, React Router, react-hook-form, and TanStack Query all assume.

The TypeScript decision is non-negotiable; it's the floor for the static-analysis story that catches the bugs vibe coders ship. See `TOOLING_DESIGN.md` for the strictness configuration.

### Alternatives considered

**Vue, Svelte, Solid.** All technically excellent — Svelte is more concise, Solid is faster at runtime. All rejected on ecosystem-depth grounds: React has materially more agent training data and a far larger library ecosystem (including shadcn/ui itself), which is the property that most reduces friction for a non-engineer + agent. The performance and conciseness wins don't matter at side-project scale.

### Trade-offs

React is verbose compared to Svelte and has weaker runtime performance than Solid. Neither matters for side-project-scale apps.

---

## Component library: shadcn/ui + Tailwind CSS v4

### Decision

**shadcn/ui** components styled with **Tailwind CSS v4**.

This is a high-stakes decision because it shapes every UI a builder writes. shadcn/ui is not an npm dependency you import from — its components are copied _into_ your repo as plain React + Tailwind source you own and can edit. Tailwind provides the styling primitives; shadcn provides the accessible, well-structured components built on top of Radix UI primitives.

### Why shadcn/ui + Tailwind

**1. Excellent default aesthetic.** shadcn's components look modern and polished out of the box — clean spacing, sensible typography, tasteful defaults. For a consumer-facing product (in the representative example, a customer forms a snap judgment about whether the service looks trustworthy before they sign up and pay), this matters more than for an app behind a corporate login. You get a credible look on day one without a designer.

**2. You own the components.** Because shadcn copies source into your repo rather than hiding it behind a package, a builder (or their agent) can restyle a `Button` or `Dialog` directly — no fighting a library's theming API, no waiting on upstream. This is ideal when the whole point is letting someone reshape the app to their brand.

**3. Strong agent training data.** Tailwind and shadcn are among the most-documented frontend tools in existence. Agents handle the utility-class idiom and shadcn's component patterns fluently, and the "copy the component, then tweak it" workflow is one agents do well.

**4. No proprietary license.** shadcn/ui (MIT) and Tailwind (MIT) are fully redistributable. For a public, MIT-licensed starter, this is a hard requirement — there are no keys to ship to downstream users, nothing that lapses, nothing a fork can't legally include.

### The enforcement concern, and how we address it

The honest weakness of Tailwind/shadcn — and historically the strongest argument _against_ it — is that it is highly _themeable_ but weak on _enforcement_. Arbitrary utility values like `bg-[#f00]`, `text-[13px]`, or `rounded-[3px]` silently bypass the design tokens with no compile or type error. For a non-engineer + agent audience that takes the path of least resistance, an unconstrained Tailwind setup quietly degrades the design system into a suggestion, and the app drifts off-brand one one-off value at a time.

We mitigate this deliberately. This is how we keep a non-engineer's app on-brand:

- **(a) A curated set of shadcn components + design tokens as CSS variables.** The starter ships only token-based components, and the palette/typography/spacing/radii live as CSS variables in `globals.css` (see Theming). Components read from these tokens, so the default path is the on-brand path.
- **(b) A lint rule discouraging arbitrary Tailwind values.** An ESLint / Tailwind `no-arbitrary-value`-style rule flags `bg-[...]`, `text-[...]`, and friends, so going off-token takes a deliberate, visible step rather than happening by accident. It's CI-enforced (zero-warnings — see `TOOLING_DESIGN.md`), which is what turns the design system from a suggestion into a contract. One blind spot to self-enforce: the rule only matches bracketed `[...]` syntax, so raw palette classes (`text-green-700`, `bg-red-500`) slip past it — they're equally off-token and equally disallowed, but the agent has to hold that line itself (see `docs/agents/ui-components.md`).
- **(c) The `cn()` / `tailwind-merge` utility.** shadcn's standard `cn()` helper (clsx + `tailwind-merge`) composes class lists predictably and resolves conflicts, so variant overrides stay sane instead of producing duplicated, fighting classes.

Together these recover most of the discipline a closed component library gives you for free, while keeping the ownership, aesthetic, and licensing wins.

### Alternatives considered

**MUI (`@mui/material`).** Mature, with a closed-component model that enforces a theme well (going off-theme is deliberate and sometimes a type error). Rejected: its default Material aesthetic looks dated for a consumer brand, you don't own/restyle its internals as freely, and — decisively for a public project — MUI's most useful pieces (the X data grid, date pickers) are proprietary and non-redistributable. shadcn + the enforcement mitigations above closes the discipline gap that would otherwise favor MUI.

**Mantine.** Good components and DX, sensible defaults. Rejected because it's still a styled component dependency you don't own line-by-line, and shadcn's copy-in model plus Tailwind has broader agent training data and the better restyling story.

**Chakra UI.** Solid accessibility and theming. Rejected on the same ownership and aesthetic grounds, and a smaller ecosystem than Tailwind/shadcn.

### Trade-offs

**Enforcement requires upkeep.** The token discipline only holds if the lint gate stays in CI and the curated component set is the default. The starter wires this up; a builder who rips out the lint rule reopens the drift problem. AGENTS.md states the rule explicitly.

**More moving parts than a single import.** shadcn's "copy components in" model means the component source lives in your repo and you maintain it. In practice this is a feature (ownership), but it does mean updates aren't a version bump — they're a re-copy. Acceptable at side-project scale.

### When to revisit

Reconsider if the enforcement mitigations prove insufficient in practice — if, despite the lint gate and curated components, real apps still drift off-brand badly enough to hurt — in which case a closed-component library with built-in theme enforcement becomes worth the ownership and aesthetic trade-offs. Also revisit if shadcn/ui's maintenance or Tailwind's direction changes materially.

---

## Lists & tables

Most side-project screens need simple lists or cards — a customer's list of bookings, a grid of upcoming sessions — not a spreadsheet. Build these with plain components, or with shadcn's `Table` for straightforward tabular data.

If you ever need real table mechanics (column sorting, filtering, pagination) over a larger dataset, the documented escape hatch is **TanStack Table behind a single `<DataTable>` wrapper** — a headless table engine rendered with shadcn's `Table` primitives, pinned to one wrapper component so every table that needs it shares the same implementation instead of each prototype reinventing it. There is no proprietary grid in this starter. Don't reach for `<DataTable>` until the simple list genuinely stops scaling.

---

## Charts (not shipped)

No charting library ships by default — the kinds of apps this starter targets rarely need data visualization. If a future prototype does, **Recharts** (declarative, React-native, MIT) is the lightweight default; **visx** is the option if you need lower-level control.

---

## Theming

### Decision

Theme via **Tailwind configuration + CSS variables** (shadcn's `:root` design tokens), defined **inline in the repo** and freely editable. **Not** a shared theme package.

### Why

The palette, typography scale, spacing, and radii live as CSS variables in `globals.css` (e.g. `--primary`, `--background`, `--radius`), and Tailwind's config maps utilities onto those tokens. Beyond the stock shadcn tokens, the starter adds first-class `--success` / `--warning` tokens (defined in `:root`, `.dark`, and `@theme inline`, so `bg-success` / `text-warning` work like any other token); add new tokens the same way rather than reaching for a raw value. shadcn components reference the tokens, so re-skinning the whole app is mostly a matter of editing a handful of CSS variables — exactly the kind of change a non-engineer can make safely with their agent.

Keeping the theme inline (rather than in a published, versioned package) is the right call at side-project scale:

- A shared package would require a registry or git-pinned dependency, a versioning strategy across the package and its consumers, and release tooling — overhead with no payoff for a single app.
- Inline tokens let a builder edit branding freely (try a warmer palette, round the corners more) without coordinating with a central package owner.

The starter ships a tasteful default — a clean, friendly default palette — kept neutral enough that the next project can re-skin it by editing the CSS variables.

### Trade-off

There's no central theme to update across multiple apps. That's a non-issue here: the starter produces independent projects, and each owns its own tokens. If you somehow ran several apps off one brand and needed them to stay in lockstep, you'd extract the tokens into a shared package then — but that's a problem you don't have on day one, and you'd be trading away the freedom to edit locally.

### When to revisit

Extract the tokens into a shared package only if you end up running several long-lived apps that must share one brand and inline drift becomes a visible problem. For a single side project, inline is the right answer indefinitely.

---

## Stripe payment UI

### Decision

Payment UI uses **Stripe-hosted Checkout** (a redirect), not an embedded card form.

### Why

When a customer pays for something — a booking, a session, a membership — the frontend's job is small: call the backend to create a Checkout Session, then redirect the browser to Stripe's hosted payment page. Stripe renders the card form, handles the payment, and redirects back to a success/cancel URL. Card data never touches our frontend (or backend), which keeps the PCI surface minimal and the frontend code thin.

### Shape

- The only client-side Stripe config is **`VITE_STRIPE_PUBLISHABLE_KEY`** (publishable keys are safe to expose in the browser bundle — see the `VITE_*` env rules in [`BACKEND_DESIGN.md`](./BACKEND_DESIGN.md)). It's validated in the client env schema.
- A "Pay / Checkout" action calls the backend, which creates the Checkout Session and returns its URL; the client navigates to it.
- **The client redirect is never trusted as proof of payment.** Payment status is confirmed server-side via Stripe webhooks. The success page should treat itself as "payment likely succeeded, confirming…" and reflect the authoritative status the backend records once the webhook lands.

If an embedded card form is ever required (rare), **Stripe Elements** (`@stripe/react-stripe-js`) is the escape hatch. For the full server side — Checkout Session creation, the `POST /api/stripe/webhook` route, signature verification, the generic `orders` schema, and the `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` env vars — see [`BACKEND_DESIGN.md`](./BACKEND_DESIGN.md).

---

## Routing, forms, data fetching, state

These are smaller decisions that the agent would otherwise make per-file. Standardizing them in the starter (and AGENTS.md) prevents per-project variance. The concrete, copy-paste-level conventions for components, hooks, context providers, and styling live in the topic docs `AGENTS.md` routes to — `docs/agents/react-patterns.md` and `docs/agents/ui-components.md` — which the agent reads before touching the relevant code.

| Concern                    | Choice                                                                      | Rationale                                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Routing**                | React Router v7                                                             | Mature, well-known, minimal API. TanStack Router is more powerful but adds a learning surface for marginal benefit.                                                                                                                                       |
| **Forms**                  | `react-hook-form` + `zod` resolver, via shadcn's `Form` components          | The shadcn `Form` wraps react-hook-form with accessible labels/messages. The validation schema is a `z.object({...})` — same shape as backend validation in Hono. Forms are typed end-to-end. Raw `useState` is permitted for trivial single-input forms. |
| **Data fetching**          | `@tanstack/react-query`                                                     | Caching, background refetch, mutation handling. Pairs cleanly with Hono's RPC client (typed `fetch`).                                                                                                                                                     |
| **Server-state mutations** | TanStack Query `useMutation` + Hono RPC                                     | Mutations call the typed Hono client; query invalidation happens in the `onSuccess` handler.                                                                                                                                                              |
| **Cross-component state**  | React Context for shared concerns (auth, theme); local `useState` otherwise | Zustand and Redux were rejected as overkill. If a project genuinely outgrows Context, that's a signal to reach for a store deliberately, not by default.                                                                                                  |

### HTTP transport alternatives considered

`ky`, `axios`, and similar `fetch` wrappers were considered as the underlying HTTP transport. Rejected because their value (retries with backoff, timeouts, non-2xx error coercion, auth hooks) overlaps with TanStack Query at the right layer, and they don't provide the end-to-end types that come from Hono's RPC client. Layering them in would create ambiguity over where retry/error logic lives without solving a real problem. Hono RPC over native `fetch` (with `credentials: 'include'` for session cookies) is the typed-from-backend story this starter is optimizing for.

---

## Mobile responsiveness

### Decision

**All views must be usable on mobile viewports** (responsive layout, touch-sized targets). **No PWA / installable / offline support.**

### Why

Consumer apps are used on phones first — in the representative example, a customer signs up and books a service from their phone between other things. Responsive layout is not optional. Tailwind's responsive prefixes make it nearly free: a single utility string covers multiple breakpoints.

```tsx
<div className="p-4 md:p-8 flex flex-col md:flex-row">
```

`p-4 md:p-8` sets padding that grows at the `md` breakpoint; `flex-col md:flex-row` stacks on phones and goes horizontal on wider screens. The starter's reference screens demonstrate the conventions, and the `<DataTable>` escape hatch should degrade gracefully on narrow viewports.

PWA support (installable apps, offline mode, service workers) is a different category of work — service-worker debugging is hostile to non-engineers, and the use case is rare. Documented out of scope.

### Trade-off

A specific project that needs offline support has to add it manually. Acceptable.

---

## Error handling

### Decision

**Root-level React error boundary** ships in the starter, catching uncaught render errors and showing a recovery UI.

### Why

Without an error boundary, a single uncaught error during render produces a white screen. For a non-engineer's app, the white screen _is_ the failure mode — no recovery, no diagnosis, no support path. The error boundary catches the error, displays a user-friendly message, and (in development) shows the stack trace.

```tsx
// Simplified shape; real implementation in src/web/components/ErrorBoundary.tsx
<ErrorBoundary fallback={<ErrorPage />}>
	<App />
</ErrorBoundary>
```

The error page logs the error (eventually to a real logging service; for now, to `console.error`) and offers a "Reload" button.

### Trade-off

Error boundaries don't catch async errors, event-handler errors, or errors in `useEffect`. Mitigation: AGENTS.md notes the limitation; TanStack Query handles async error states for data fetching (the dominant async case in practice).
