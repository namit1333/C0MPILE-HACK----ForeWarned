// npx tsx scripts/smoke.ts <repoUrl> <changeId>
// Drives lib/pipeline.ts exactly like the API routes + UI do: scan -> getRepo -> startFix -> poll getJob.
// Opens a real PR (unless the repo is not ours). Run scripts/reset.ts afterwards.
import { scan, getRepo, startFix, getJob } from "../lib/pipeline";

try { process.loadEnvFile(".env.local"); } catch {}

async function main() {
  const url = process.argv[2];
  const t0 = Date.now();
  const at = () => `[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s]`;

  // POST /api/scan
  const state = await scan(url, (s) => console.log(at(), "scan:", s));
  console.log(at(), `scan -> id=${state.id}, ${state.inventory.dependencies.length} deps, ${state.alerts.length} alerts:`);
  for (const a of state.alerts) console.log("       ", a.id, a.type, a.deadline ?? "", a.status);

  // GET /api/repos/[id]
  const again = await getRepo(state.id);
  console.log(at(), `getRepo(${state.id}) -> ${again ? `${again.alerts.length} alerts, ${again.changes.length} change records` : "MISSING"}`);

  // POST /api/alerts/[id]/fix
  const alert = state.alerts.find((a) => a.changeId === process.argv[3])!;
  const jobId = await startFix(alert.id);
  console.log(at(), `startFix(${alert.id}) -> jobId=${jobId}`);

  // GET /api/jobs/[id], polled every second like the UI
  let seen = 0;
  for (;;) {
    const job = await getJob(jobId);
    if (!job) { console.log(at(), "job file missing"); break; }
    for (const line of job.log.slice(seen)) console.log(at(), "  feed:", line);
    seen = job.log.length;
    if (job.status !== "running") {
      console.log(at(), `job ${job.status}: prUrl=${job.prUrl ?? "-"} verification=${job.verification} attempts=${job.attempts}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await new Promise((r) => setTimeout(r, 300)); // let the alert status write land
  const after = await getRepo(state.id);
  console.log(at(), `alert status now: ${after?.alerts.find((a) => a.id === alert.id)?.status}`);
}
main();
