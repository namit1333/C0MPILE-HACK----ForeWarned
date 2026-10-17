// npx tsx scripts/seed-demo.ts — scan the demo repo and copy into fixtures/repos/ for cold starts.
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { scan } from "../lib/pipeline";

async function main() {
  const url = process.argv[2] ?? "https://github.com/A5bhinav/openai-api-example";
  const state = await scan(url, (s) => console.error(s));
  console.error("id:", state.id);
  console.error(
    "alerts:",
    state.alerts.map((a) => `${a.changeId}:${a.callSites.length}:${a.status}`).join(", "),
  );
  console.error(
    "deps:",
    state.inventory.dependencies
      .map((d) => `${d.package ?? d.provider}@${d.version} sites=${d.callSites.length}`)
      .join(", "),
  );
  if (state.notes.length) console.error("notes:", state.notes);

  const fixtures = path.join("fixtures", "repos");
  await mkdir(fixtures, { recursive: true });
  const src = path.join("data", "repos", `${state.id}.json`);
  const dest = path.join(fixtures, `${state.id}.json`);
  await copyFile(src, dest);
  console.log(dest);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
