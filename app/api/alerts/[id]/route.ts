// GET /api/alerts/[id] -> { alert, change, repo, pr? } (pr: our currently open PR for this alert, if any)
import { connection } from "next/server";
import { findAlert, findJobByPrUrl } from "@/lib/pipeline";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const found = await findAlert(id);
  if (!found) return Response.json({ error: `Unknown alert ${id}` }, { status: 404 });
  const pr = found.state.openPRs?.[found.alert.id];
  const job = pr ? await findJobByPrUrl(pr.url) : undefined; // the real run that opened this PR, if it ran here
  return Response.json({ alert: found.alert, change: found.change, repo: found.state.inventory.repo, ...(pr ? { pr } : {}), ...(job ? { job } : {}) });
}
