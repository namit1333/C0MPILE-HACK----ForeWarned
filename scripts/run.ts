// npx tsx scripts/run.ts <repoUrl> [--dry-run] [--change <id>] [--changes <dir>] [--json]
// clone -> scan -> match -> fix the first alert (or --change <id>), printing each step.
import { fixAlert } from "../lib/agent/fix";
import { loadChanges, match } from "../lib/matcher";
import { cloneRepo, parseRepo } from "../lib/repo";
import { inventoryStats, scanRepoDetailed } from "../lib/scanner/scan";

try { process.loadEnvFile(".env.local"); } catch {}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const repoUrl = args.find((a, i) => !a.startsWith("--") && !["--change", "--changes"].includes(args[i - 1]));
  if (!repoUrl) {
    console.error("usage: npx tsx scripts/run.ts <repoUrl> [--dry-run] [--change <id>] [--changes <dir>] [--json] [--scan-only]");
    process.exit(1);
  }

  const t0 = Date.now();
  const step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${s}`);

  const ref = parseRepo(repoUrl);
  step(`Cloning ${ref.slug}`);
  const dir = await cloneRepo(repoUrl);
  step(`Cloned to ${dir}`);

  const { inventory, notes } = await scanRepoDetailed(dir, ref.slug);
  const stats = inventoryStats(inventory);
  for (const n of notes) step(`NOTE ${n}`);
  step(`Depends on ${stats.apis} APIs, ${stats.callSites} call sites`);
  for (const d of inventory.dependencies) {
    console.log(`  ${d.provider}${d.package ? ` (${d.package}@${d.version ?? "?"})` : ""}: ${d.callSites.length} sites`);
    for (const c of d.callSites) console.log(`    ${c.kind.padEnd(13)} ${c.file}:${c.line}  ${c.symbol}`);
  }
  if (flag("--json")) console.log(JSON.stringify(inventory, null, 2));

  const changes = await loadChanges(opt("--changes"), (w) => step(`WARN ${w}`));
  step(`Loaded ${changes.length} change records`);
  const alerts = match(inventory, changes);
  step(`${alerts.length} alerts`);
  for (const a of alerts) console.log(`  [${a.type}] ${a.changeId}${a.deadline ? ` (deadline ${a.deadline})` : ""}: ${a.callSites.length} call sites`);

  if (flag("--scan-only") || !alerts.length) process.exit(0);

  const wanted = opt("--change");
  const alert = wanted ? alerts.find((a) => a.changeId === wanted) : alerts.find((a) => a.type !== "feature") ?? alerts[0];
  if (!alert) {
    console.error(`No alert for change ${wanted}`);
    process.exit(1);
  }
  const change = changes.find((c) => c.id === alert.changeId)!;
  step(`Fixing ${change.id}${flag("--dry-run") ? " (dry run)" : ""}`);
  const result = await fixAlert(alert, change, dir, step, { dryRun: flag("--dry-run") });
  console.log(JSON.stringify({ ...result, log: undefined }, null, 2));
  step(result.prUrl ? `Done: ${result.prUrl}` : `Done (no PR). Work dir: ${dir}`);
  process.exit(result.prUrl || flag("--dry-run") ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
