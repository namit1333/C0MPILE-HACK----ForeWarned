# Forewarned (working name): project brief for coding agents

## What we're building
A web app for engineering teams whose code calls third-party APIs. Connect a GitHub repo and it:
1. Builds an API inventory: every external SDK and API the repo uses, with every call site.
2. Shows "what's coming": provider changes that affect this code. That means breaking SDK
   releases, models or endpoints being shut down on a date, and new features that apply.
3. Opens a fix PR for a change that affects the repo: patches the call sites, runs the type
   checker and tests, retries on errors, and labels the PR with exactly what was verified.
4. (Stretch) Opens an "opportunity" PR that adopts a useful new provider feature.
One-liner: Dependabot tells you a new version exists. We tell you what's about to break,
and what you're missing, before it happens.

## Context
- Built today at a one-day hackathon judged by YC founders. Challenge: YC Request for
  Startups, Fall 2026, "Self-Maintaining APIs".
- A demo-grade prototype of one workflow, not a production system. Feature freeze 3:30 PM,
  submission due 4:30 PM. Working beats elegant.

## How it works
GitHub repo (our fork) -> cloneRepo -> scanRepo -> Inventory
Change records (hand-written JSON in data/changes/) + Inventory -> match -> Alerts
User clicks "Open fix PR" on an alert -> fixAlert:
  runChecks (before) -> new branch forewarned/<change id>
  -> coding agent patches the call sites using change.migration
  -> runChecks (after) -> on failure, retry with the errors (max 2 more attempts)
  -> open a PR on our fork only if the type check passes
  -> verification label: tests-exercise-call | type-checked | unverified
The UI polls data/jobs/<id>.json for live progress (FixResult.log).

## Scope today
In: TypeScript/JavaScript repos. OpenAI first: Node SDK v3 -> v4, and one upcoming model
shutdown. A "Check now" button instead of a background watcher. PRs only on forks we own.
Stretch: Supabase JS v1 -> v2; the opportunity PR; running checks in Freestyle sandboxes.
Out: auth, billing, a GitHub App install flow, databases (JSON files only), other languages,
automatic change extraction (change records are hand-written today).

## Repo layout and owners (stay inside your own folders)
lib/types.ts     shared contracts. Never change without telling all three people.
lib/, scripts/   the pipeline. Builder: Josh.
app/, fixtures/  UI, API routes, fake data. Demo engineer.
data/changes/    hand-written ChangeRecord JSON. Content and QA.
demo-repos/      local clones of test repos, including forewarned-sample.
data/jobs/       live progress of fix runs.

## Stack
Next.js (App Router), TypeScript, Tailwind. Scripts run with `npx tsx`.
ts-morph for code analysis, semver for version ranges, Octokit for GitHub, zod for validation.
Secrets live in .env.local (GITHUB_TOKEN, the LLM API key). Never commit or print them.

## Rules
- Read lib/types.ts before writing code, and code against it.
- Never push to an upstream repo. Branches and PRs go only to our own forks.
- Never claim more than was checked. A label says "type-checked" or "tests-exercise-call"
  only when that check actually ran and passed; otherwise "unverified".
- Build the simplest thing that works on the demo repos. No premature abstraction.
- Every long-running step reports progress through onLog so the UI can show it.
- Commit small and often; keep main runnable.

## Glossary
Inventory: every external API or SDK a repo uses, with its call sites.
Change record: one provider change (breaking | deprecation | feature), with the symbols or
  patterns it affects and the migration steps.
Alert: a change record that matches this repo's inventory.
Fix PR: a branch on our fork that migrates the affected call sites, with checks and a label.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
