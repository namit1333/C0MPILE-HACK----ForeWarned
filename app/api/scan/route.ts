// POST /api/scan { repoUrl } -> RepoState { id, repoUrl, inventory, alerts, changes }
import { scan } from "@/lib/pipeline";
import { parseRepo } from "@/lib/repo";

export async function POST(request: Request) {
  let body: { repoUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { \"repoUrl\": \"https://github.com/owner/name\" }" }, { status: 400 });
  }
  const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : "";
  if (!repoUrl) return Response.json({ error: "repoUrl is required" }, { status: 400 });

  // Only GitHub repos from the web: parseRepo also accepts local paths, which visitors must not reach.
  let ref;
  try {
    ref = parseRepo(repoUrl);
  } catch {
    return Response.json({ error: "Paste a GitHub repo URL, like https://github.com/owner/name" }, { status: 400 });
  }
  if (ref.owner === "local") return Response.json({ error: "Only GitHub repos can be scanned" }, { status: 400 });

  try {
    return Response.json(await scan(`https://github.com/${ref.slug}`));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/clone failed/i.test(message)) {
      return Response.json({ error: `Couldn't clone ${ref.slug}. Check the URL and that the repo is public.` }, { status: 404 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
