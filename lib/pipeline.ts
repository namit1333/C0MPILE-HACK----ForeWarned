// Glue for the API routes: each function maps to one route. Runtime state is JSON in data/.
import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fixAlert, type FixOptions } from "./agent/fix";
import { loadChanges, match, repoId } from "./matcher";
import { cloneRepo, parseRepo } from "./repo";
import { scanRepo } from "./scanner/scan";
import type { Alert, ChangeRecord, FixResult, Inventory } from "./types";

const DATA = path.join(process.cwd(), "data");
const REPOS = path.join(DATA, "repos");
const JOBS = path.join(DATA, "jobs");

export interface RepoState {
  id: string; // "owner__name", URL-safe
  repoUrl: string;
  inventory: Inventory;
  alerts: Alert[];
  changes: ChangeRecord[]; // the records behind the alerts, for the UI
}

export type JobStatus = "running" | "done" | "failed";
export type Job = FixResult & { jobId: string; status: JobStatus };

export { repoId };

async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file); // atomic, so a polling reader never sees half a file
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

// POST /api/scan {repoUrl}
export async function scan(repoUrl: string, onLog: (s: string) => void = () => {}): Promise<RepoState> {
  const ref = parseRepo(repoUrl);
  onLog(`Cloning ${ref.slug}`);
  const dir = await cloneRepo(repoUrl);
  onLog("Scanning for API usage");
  const inventory = await scanRepo(dir, ref.slug);
  const changes = await loadChanges();
  const alerts = match(inventory, changes);
  const used = new Set(alerts.map((a) => a.changeId));
  const state: RepoState = {
    id: repoId(ref.slug),
    repoUrl,
    inventory,
    alerts,
    changes: changes.filter((c) => used.has(c.id)),
  };
  await writeJson(path.join(REPOS, `${state.id}.json`), state);
  return state;
}

// GET /api/repos/[id]
export async function getRepo(id: string): Promise<RepoState | undefined> {
  if (!/^[\w.-]+$/.test(id) || id.includes("..")) return undefined; // ids come from URLs
  return readJson<RepoState>(path.join(REPOS, `${id}.json`));
}

export async function findAlert(alertId: string): Promise<{ state: RepoState; alert: Alert; change: ChangeRecord } | undefined> {
  // Look the alert up instead of parsing its id: repo names can contain "--".
  let files: string[] = [];
  try {
    files = (await readdir(REPOS)).filter((f) => f.endsWith(".json"));
  } catch {}
  let state: RepoState | undefined;
  let alert: Alert | undefined;
  for (const f of files) {
    const s = await readJson<RepoState>(path.join(REPOS, f));
    alert = s?.alerts.find((a) => a.id === alertId);
    if (alert) { state = s; break; }
  }
  if (!state || !alert) return undefined;
  const change = state.changes.find((c) => c.id === alert.changeId) ?? (await loadChanges()).find((c) => c.id === alert.changeId);
  return change ? { state, alert, change } : undefined;
}

async function setAlertStatus(state: RepoState, alertId: string, status: Alert["status"]) {
  const fresh = (await getRepo(state.id)) ?? state;
  const a = fresh.alerts.find((x) => x.id === alertId);
  if (a) a.status = status;
  await writeJson(path.join(REPOS, `${fresh.id}.json`), fresh);
}

// POST /api/alerts/[id]/fix -> { jobId }. Runs in the background; poll getJob.
export async function startFix(alertId: string, opts: FixOptions = {}): Promise<string> {
  const found = await findAlert(alertId);
  if (!found) throw new Error(`Unknown alert ${alertId}. Scan the repo first.`);
  const { state, alert, change } = found;
  // One fix per alert at a time (a rescan resets statuses if a run ever dies mid-way).
  if (alert.status === "fixing") throw new Error(`A fix for ${alertId} is already running.`);
  const jobId = randomUUID().slice(0, 8);
  const file = path.join(JOBS, `${jobId}.json`);
  const job: Job = {
    jobId,
    status: "running",
    alertId,
    branch: `forewarned/${change.id}`,
    filesChanged: [],
    checks: [],
    verification: "unverified",
    attempts: 0,
    log: [],
  };
  await writeJson(file, job);
  await setAlertStatus(state, alertId, "fixing");

  void (async () => {
    // Serialise writes so log lines land in order.
    let writing = Promise.resolve();
    const persist = () => (writing = writing.then(() => writeJson(file, job)).catch(() => {}));
    const onLog = (step: string) => {
      job.log.push(step);
      persist();
    };
    try {
      onLog(`Cloning ${state.inventory.repo}`);
      const dir = await cloneRepo(state.repoUrl);
      const result = await fixAlert(alert, change, dir, onLog, opts);
      Object.assign(job, result, { log: job.log, status: result.prUrl || opts.dryRun ? "done" : "failed" });
    } catch (e) {
      job.log.push(`Failed: ${e instanceof Error ? e.message : String(e)}`);
      job.status = "failed";
    }
    await persist();
    // A dry run opens no PR, so the alert goes back to "open" rather than claiming one.
    await setAlertStatus(state, alertId, job.prUrl ? "pr-opened" : job.status === "done" ? "open" : "failed");
  })();

  return jobId;
}

// GET /api/jobs/[id]
export async function getJob(jobId: string): Promise<Job | undefined> {
  if (!/^[\w-]+$/.test(jobId)) return undefined;
  return readJson<Job>(path.join(JOBS, `${jobId}.json`));
}
