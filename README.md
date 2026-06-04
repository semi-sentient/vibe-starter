# vibe-starter

An opinionated, MIT-licensed full-stack TypeScript starter: Vite + React on the
front end, Hono + PostgreSQL on the back end, wired together with end-to-end
type safety. Designed to give a solo builder (and their AI agent) a modern,
maintainable foundation to ship a real app on.

## Quick Start

```bash
# 1. Clone your repo (created from this template)
git clone <your-new-repo-url>
cd <your-repo>

# 2. Configure environment
cp .env.example .env

# 3. One-time setup (creates .env if missing, generates SESSION_SECRET)
bash scripts/bootstrap.sh

# 4. Start Postgres
docker compose up -d

# 5. Install dependencies
npm install

# 6. Start the dev server (Vite on :5173, Hono on :3000)
npm run dev
```

Then open <http://localhost:5173> — you should see the Welcome page with a live
`API ✓ connected` status badge.

A fuller README (stack, project structure, development workflow, deploy, and
skills) ships closer to launch.
