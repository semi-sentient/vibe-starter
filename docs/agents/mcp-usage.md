# MCP Server Usage

Use MCP sparingly — only when it's the right tool for the moment. TS defs in `node_modules` are authoritative and version-correct, so reach for MCP only when the type shape can't answer a question about intent/usage, or for libraries not yet installed (PRD research, comparing alternatives) where no defs exist. Don't fetch docs "just to confirm" something the types already tell you.

Configured servers: `context7` (see `.mcp.json`) — the fallback for any installed library without a dedicated server (TanStack Query, React Hook Form, React Router, Hono, Drizzle, Zod, Stripe, …).

**Version-drift gotcha:** context7 docs can lag the installed version. Check the version in `package.json`, put the major version in the query (`"Drizzle ORM v0.45 relational query API"`, not just `"Drizzle"`), and validate any returned API against the TS defs in `node_modules`.
</content>
