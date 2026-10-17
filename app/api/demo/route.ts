// POST /api/demo — seed the offline sample RepoState into data/repos for a resilient walkthrough.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sample from "@/fixtures/sample-repo.json";
import type { RepoState } from "@/lib/pipeline";

export async function POST() {
  const state = structuredClone(sample) as RepoState;
  // Reset alert statuses so the walkthrough can be replayed.
  for (const a of state.alerts) a.status = "open";
  state.inventory.scannedAt = new Date().toISOString();

  const dir = path.join(process.cwd(), "data", "repos");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${state.id}.json`), JSON.stringify(state, null, 2));
  return Response.json(state);
}
