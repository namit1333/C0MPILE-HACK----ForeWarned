// GET /api/alerts/[id] -> { alert, change, repo: { id, repoUrl, slug } }
import { connection } from "next/server";
import { findAlert } from "@/lib/pipeline";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const found = await findAlert(id);
  if (!found) return Response.json({ error: `Unknown alert ${id}. Scan the repo first.` }, { status: 404 });
  const { state, alert, change } = found;
  return Response.json({ alert, change, repo: { id: state.id, repoUrl: state.repoUrl, slug: state.inventory.repo } });
}
