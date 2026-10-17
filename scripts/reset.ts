// npx tsx scripts/reset.ts [repoUrl ...]
// Closes our open Forewarned PRs and deletes forewarned/* branches on our forks.
// With no args, resets every repo scanned so far (data/repos/*.json) plus FOREWARNED_DEMO_REPOS (comma-separated).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { octokit } from "../lib/github";
import { parseRepo } from "../lib/repo";

try { process.loadEnvFile(".env.local"); } catch {}

async function main() {
  async function targets(): Promise<string[]> {
    const fromArgs = process.argv.slice(2);
    if (fromArgs.length) return fromArgs;
    const out = (process.env.FOREWARNED_DEMO_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const dir = path.join(process.cwd(), "data", "repos");
    try {
      for (const f of await readdir(dir)) {
        if (f.endsWith(".json")) out.push(JSON.parse(await readFile(path.join(dir, f), "utf8")).repoUrl);
      }
    } catch {}
    return [...new Set(out)];
  }

  const gh = octokit();
  const { data: me } = await gh.users.getAuthenticated();
  const repos = await targets();
  if (!repos.length) console.log("No repos to reset. Pass repo URLs or scan something first.");

  for (const url of repos) {
    const ref = parseRepo(url);
    if (ref.owner === "local") continue;
    const { data: repo } = await gh.repos.get({ owner: ref.owner, repo: ref.name });
    if (!repo.fork && ref.owner.toLowerCase() !== me.login.toLowerCase() && !(process.env.FOREWARNED_ALLOWED_OWNERS ?? "").toLowerCase().split(",").includes(ref.owner.toLowerCase())) {
      console.log(`skip ${ref.slug}: not ours`);
      continue;
    }
    const prs = await gh.paginate(gh.pulls.list, { owner: ref.owner, repo: ref.name, state: "open", per_page: 100 });
    for (const pr of prs.filter((p) => p.head.ref.startsWith("forewarned/") && p.head.repo?.full_name === ref.slug)) {
      await gh.pulls.update({ owner: ref.owner, repo: ref.name, pull_number: pr.number, state: "closed" });
      console.log(`${ref.slug}: closed PR #${pr.number}`);
    }
    const branches = await gh.paginate(gh.repos.listBranches, { owner: ref.owner, repo: ref.name, per_page: 100 });
    for (const b of branches.filter((b) => b.name.startsWith("forewarned/"))) {
      await gh.git.deleteRef({ owner: ref.owner, repo: ref.name, ref: `heads/${b.name}` });
      console.log(`${ref.slug}: deleted branch ${b.name}`);
    }
  }
  console.log("Reset done.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
