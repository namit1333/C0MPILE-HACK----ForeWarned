// POST /api/demo/fix { alertId } — simulate a fix job so the UI can poll GET /api/jobs/[id]
// without cloning a real repo or calling an LLM. Demo / offline only.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Alert, Verification } from "@/lib/types";
import type { Job, RepoState } from "@/lib/pipeline";

const REPOS = path.join(process.cwd(), "data", "repos");
const JOBS = path.join(process.cwd(), "data", "jobs");

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

async function loadDemoState(): Promise<RepoState | undefined> {
  try {
    return JSON.parse(await readFile(path.join(REPOS, "demo__forewarned-sample.json"), "utf8")) as RepoState;
  } catch {
    return undefined;
  }
}

const STEPS = [
  "Cloning demo/forewarned-sample",
  "Running checks (before)",
  "Creating branch forewarned/{change}",
  "Applying migration to call sites",
  "Running type check",
  "Running tests",
  "Opening pull request",
  "Labeling PR with verification",
];

export async function POST(request: Request) {
  let body: { alertId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { \"alertId\": \"...\" }" }, { status: 400 });
  }
  const alertId = typeof body.alertId === "string" ? body.alertId : "";
  if (!alertId.startsWith("demo__")) {
    return Response.json({ error: "Demo fix only works on the offline sample alerts." }, { status: 400 });
  }

  const state = await loadDemoState();
  if (!state) {
    return Response.json({ error: "Load the offline sample first (POST /api/demo)." }, { status: 404 });
  }
  const alert = state.alerts.find((a) => a.id === alertId) as Alert | undefined;
  if (!alert) return Response.json({ error: `Unknown demo alert ${alertId}` }, { status: 404 });
  if (alert.status === "fixing") {
    return Response.json({ error: `A fix for ${alertId} is already running.` }, { status: 409 });
  }

  const change = state.changes.find((c) => c.id === alert.changeId);
  const branch = `forewarned/${alert.changeId}`;
  const jobId = randomUUID().slice(0, 8);
  const verification: Verification =
    alert.type === "feature" ? "type-checked" : "tests-exercise-call";
  const filesChanged = [...new Set(alert.callSites.map((c) => c.file))];

  const job: Job = {
    jobId,
    status: "running",
    alertId,
    branch,
    filesChanged: [],
    checks: [],
    verification: "unverified",
    attempts: 0,
    log: [],
  };
  await writeJson(path.join(JOBS, `${jobId}.json`), job);

  alert.status = "fixing";
  await writeJson(path.join(REPOS, `${state.id}.json`), state);

  void (async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      for (const step of STEPS) {
        await sleep(450);
        job.log.push(step.replace("{change}", alert.changeId));
        if (step.includes("migration")) {
          job.filesChanged = filesChanged;
          job.attempts = 1;
        }
        if (step.includes("type check")) {
          job.checks = [
            { name: "tsc", before: "fail", after: "pass" },
            { name: "tests", before: "pass", after: "pass" },
          ];
        }
        await writeJson(path.join(JOBS, `${jobId}.json`), job);
      }
      job.prUrl = `https://github.com/demo/forewarned-sample/pull/${Math.floor(Math.random() * 40) + 10}`;
      job.verification = verification;
      job.status = "done";
      await writeJson(path.join(JOBS, `${jobId}.json`), job);

      const fresh = await loadDemoState();
      if (fresh) {
        const a = fresh.alerts.find((x) => x.id === alertId);
        if (a) a.status = "pr-opened";
        await writeJson(path.join(REPOS, `${fresh.id}.json`), fresh);
      }
    } catch (e) {
      job.log.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
      job.status = "failed";
      await writeJson(path.join(JOBS, `${jobId}.json`), job);
    }
  })();

  return Response.json({ jobId, changeTitle: change?.title ?? alert.changeId }, { status: 202 });
}
