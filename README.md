# Forewarned

Dependabot tells you a new version exists. We tell you what's about to break — and what you're missing — before it happens.

Hackathon prototype (YC RFS Fall 2026, Self-Maintaining APIs): connect a GitHub repo, inventory third-party API call sites, match provider change records, and open a verified fix PR on a fork you own.

## Demo path (cold start)

```bash
cp .env.example .env.local   # add GITHUB_TOKEN + ANTHROPIC_API_KEY (or use `gh` + claude/codex CLI)
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. **Open pre-scanned dashboard →** — loads the committed scan for `A5bhinav/openai-api-example` (no clone required).
2. Pick an alert under **What's coming** — call sites are live from the inventory.
3. **Open fix PR** — runs the agent, typecheck/tests, and opens a PR on a pushable fork. Needs secrets above.
4. Or hit **Scan** / **Check now** to re-scan any public GitHub repo.

Refresh the fixture after changing scanners or change records:

```bash
npm run seed-demo
```

## What it does

| Step | Where |
|------|--------|
| Clone → scan → match → save | `POST /api/scan` → `data/repos/` (fixtures in `fixtures/repos/` for cold start) |
| Dashboard | `/repo/<owner__name>` |
| Fix job + live log | `POST /api/alerts/<id>/fix` → poll `/api/jobs/<id>` |
| Change records | `data/changes/*.json` |

PRs only go to forks you own (or `FOREWARNED_ALLOWED_OWNERS`). Verification labels: `tests-exercise-call` | `type-checked` | `unverified`.

## CLI

```bash
npx tsx scripts/run.ts https://github.com/A5bhinav/openai-api-example --scan-only
npx tsx scripts/run.ts https://github.com/YOUR/fork --dry-run --change openai-node-v4
npm run seed-demo
```

## Stack

Next.js App Router, TypeScript, Tailwind, ts-morph, Octokit, Zod. Scripts via `npx tsx`.
