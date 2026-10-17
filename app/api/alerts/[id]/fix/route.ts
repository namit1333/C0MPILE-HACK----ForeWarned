// POST /api/alerts/[id]/fix -> { jobId }. The fix runs in the background; poll GET /api/jobs/[jobId].
// Add ?dryRun=1 to patch and check without pushing or opening a PR (for UI testing).
import { startFix } from "@/lib/pipeline";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    const jobId = await startFix(id, { dryRun });
    return Response.json({ jobId }, { status: 202 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /unknown alert/i.test(message) ? 404 : /already running/i.test(message) ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
