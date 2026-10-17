import { Octokit } from "@octokit/rest";
import type { RepoRef } from "./repo";

let client: Octokit | undefined;

export function octokit(): Octokit {
  const auth = process.env.GITHUB_TOKEN;
  if (!auth) throw new Error("GITHUB_TOKEN is not set (put it in .env.local)");
  client ??= new Octokit({ auth, userAgent: "forewarned-hackathon" });
  return client;
}

// We only ever push to repos we own: a fork, the token's own account, or an explicitly allowed owner.
export async function assertPushable(ref: RepoRef): Promise<{ defaultBranch: string }> {
  const gh = octokit();
  const { data: repo } = await gh.repos.get({ owner: ref.owner, repo: ref.name });
  const { data: me } = await gh.users.getAuthenticated();
  const allowed = (process.env.FOREWARNED_ALLOWED_OWNERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const owner = ref.owner.toLowerCase();
  const ours = repo.fork || owner === me.login.toLowerCase() || allowed.includes(owner);
  if (!ours) {
    throw new Error(
      `Refusing to push to ${ref.slug}: not a fork and not owned by ${me.login}. Fork it first, or add the owner to FOREWARNED_ALLOWED_OWNERS.`,
    );
  }
  if (repo.permissions && !repo.permissions.push) {
    throw new Error(`The GITHUB_TOKEN user (${me.login}) has no push access to ${ref.slug}.`);
  }
  return { defaultBranch: repo.default_branch };
}

export async function openOrUpdatePR(
  ref: RepoRef,
  opts: { branch: string; base: string; title: string; body: string; labels?: string[] },
): Promise<string> {
  const gh = octokit();
  const existing = await gh.pulls.list({ owner: ref.owner, repo: ref.name, head: `${ref.owner}:${opts.branch}`, state: "open" });
  let number: number;
  let url: string;
  if (existing.data.length) {
    const pr = existing.data[0];
    await gh.pulls.update({ owner: ref.owner, repo: ref.name, pull_number: pr.number, title: opts.title, body: opts.body });
    number = pr.number;
    url = pr.html_url;
  } else {
    const { data: pr } = await gh.pulls.create({
      owner: ref.owner,
      repo: ref.name,
      head: opts.branch,
      base: opts.base,
      title: opts.title,
      body: opts.body,
    });
    number = pr.number;
    url = pr.html_url;
  }
  if (opts.labels?.length) {
    try {
      await gh.issues.setLabels({ owner: ref.owner, repo: ref.name, issue_number: number, labels: opts.labels });
    } catch {
      // Labels are nice-to-have; the verification is also in the PR body.
    }
  }
  return url;
}
