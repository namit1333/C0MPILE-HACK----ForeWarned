import type { Alert, ChangeRecord, FixResult, Inventory, Verification } from "@/lib/types";

export type RepoState = {
  id: string;
  repoUrl: string;
  inventory: Inventory;
  alerts: Alert[];
  changes: ChangeRecord[];
};

export type JobStatus = "running" | "done" | "failed";
export type Job = FixResult & { jobId: string; status: JobStatus };

export const DEMO_REPO_URL =
  process.env.NEXT_PUBLIC_DEMO_REPO?.trim() || "https://github.com/demo/forewarned-sample";

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    /* ignore */
  }
  return res.statusText || `Request failed (${res.status})`;
}

export async function scanRepo(repoUrl: string): Promise<RepoState> {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl }),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<RepoState>;
}

export async function loadOfflineDemo(): Promise<RepoState> {
  const res = await fetch("/api/demo", { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<RepoState>;
}

export async function startFix(alertId: string, opts?: { dryRun?: boolean; demo?: boolean }): Promise<string> {
  const path = opts?.demo
    ? "/api/demo/fix"
    : `/api/alerts/${encodeURIComponent(alertId)}/fix${opts?.dryRun ? "?dryRun=1" : ""}`;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: opts?.demo ? JSON.stringify({ alertId }) : undefined,
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { jobId: string };
  return data.jobId;
}

export async function getJob(jobId: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<Job>;
}

export function changeForAlert(state: RepoState, alert: Alert): ChangeRecord | undefined {
  return state.changes.find((c) => c.id === alert.changeId);
}

export function verificationLabel(v: Verification): string {
  return v;
}

export function typeLabel(type: Alert["type"]): string {
  if (type === "breaking") return "Breaking";
  if (type === "deprecation") return "Deprecation";
  return "Opportunity";
}
