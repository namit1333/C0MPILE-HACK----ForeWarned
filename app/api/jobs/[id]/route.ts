// GET /api/jobs/[id] -> Job: FixResult so far plus { jobId, status: "running" | "done" | "failed" }.
// Poll every second; `log` grows as the fix runs.
import { connection } from "next/server";
import { getJob } from "@/lib/pipeline";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: `No job ${id}` }, { status: 404 });
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}
