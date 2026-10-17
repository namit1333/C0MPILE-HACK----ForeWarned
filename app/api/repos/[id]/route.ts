// GET /api/repos/[id] -> RepoState (id is "owner__name", as returned by POST /api/scan)
import { connection } from "next/server";
import { getRepo } from "@/lib/pipeline";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection(); // always read the latest scan, never prerender
  const { id } = await params;
  const state = await getRepo(id);
  if (!state) return Response.json({ error: `No scan for ${id}. POST /api/scan first.` }, { status: 404 });
  return Response.json(state);
}
