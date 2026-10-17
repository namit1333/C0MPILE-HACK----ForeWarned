// npx tsx scripts/scan-batch.ts <file with one repo URL per line> <out.jsonl> [concurrency=4]
// Scans many repos (read-only: clone + scan + match, no fixes), each in its own process with a 5-minute limit.
import { execFile } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
const [list, outFile, conc = "4"] = process.argv.slice(2);
const urls = readFileSync(list, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
let i = 0;
async function worker() {
  while (i < urls.length) {
    const url = urls[i++];
    const t0 = Date.now();
    const line = await new Promise<string>((resolve) => {
      execFile("npx", ["tsx", "scripts/scan-one.ts", url], { timeout: 300_000, maxBuffer: 50e6, env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" } }, (err, stdout, stderr) => {
        const r = stdout.split("\n").find((l) => l.startsWith("RESULT "));
        if (r) return resolve(r.slice(7));
        resolve(JSON.stringify({ url, error: err?.killed ? "TIMEOUT after 300s" : (stderr || String(err)).slice(-300), totalS: (Date.now() - t0) / 1000 }));
      });
    });
    appendFileSync(outFile, line + "\n");
    const j = JSON.parse(line);
    console.log(`${url.replace("https://github.com/", "").padEnd(42)} ${j.error ? "ERR " + j.error.split("\n")[0].slice(0, 90) : `clone ${j.cloneS}s scan ${j.scanS}s src ${j.src} | ${j.stats.apis} APIs ${j.stats.callSites} sites | alerts ${j.alerts.join(",") || "-"}`}`);
  }
}
Promise.all(Array.from({ length: +conc }, worker)).then(() => console.log("BATCH DONE"));
