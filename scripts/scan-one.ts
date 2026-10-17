// npx tsx scripts/scan-one.ts <repoUrl>: clone + scan one repo, print a RESULT JSON line (used by scan-batch.ts).
import { readdirSync } from "node:fs";
import path from "node:path";
import { cloneRepo, parseRepo } from "../lib/repo";
import { loadChanges, match } from "../lib/matcher";
import { inventoryStats, scanRepoDetailed } from "../lib/scanner/scan";

function countFiles(dir: string) {
  let src = 0, all = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!["node_modules", ".git"].includes(e.name)) walk(path.join(d, e.name)); }
      else { all++; if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(e.name) && !e.name.endsWith(".d.ts")) src++; }
    }
  };
  walk(dir);
  return { src, all };
}

async function main() {
  const url = process.argv[2];
  const out: Record<string, unknown> = { url };
  const t0 = Date.now();
  try {
    const ref = parseRepo(url);
    const dir = await cloneRepo(url);
    out.cloneS = +((Date.now() - t0) / 1000).toFixed(1);
    Object.assign(out, countFiles(dir));
    const t1 = Date.now();
    const { inventory: inv, notes } = await scanRepoDetailed(dir, ref.slug);
    out.notes = notes;
    out.scanS = +((Date.now() - t1) / 1000).toFixed(1);
    out.rssMB = Math.round(process.memoryUsage().rss / 1e6);
    out.stats = inventoryStats(inv);
    out.deps = inv.dependencies.map((d) => {
      const kinds: Record<string, number> = {};
      for (const c of d.callSites) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      return `${d.provider}${d.package ? `|${d.package}@${d.version ?? "?"}` : ""} ${JSON.stringify(kinds)}`;
    });
    out.alerts = match(inv, await loadChanges()).map((a) => `${a.changeId}:${a.callSites.length}`);
    out.dir = dir;
  } catch (e) {
    out.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  }
  out.totalS = +((Date.now() - t0) / 1000).toFixed(1);
  console.log("RESULT " + JSON.stringify(out));
}
main();
