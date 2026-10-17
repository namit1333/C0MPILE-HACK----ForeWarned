import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface RepoRef {
  owner: string;
  name: string;
  slug: string; // "owner/name"
  cloneUrl: string;
}

// Accepts "owner/name", "https://github.com/owner/name(.git)(/tree/...)", "git@github.com:owner/name.git",
// or a local path (for testing; slug becomes "local/<dirname>").
export function parseRepo(input: string): RepoRef {
  const s = input.trim().replace(/\/+$/, "");
  if (existsSync(s)) {
    const name = path.basename(path.resolve(s));
    return { owner: "local", name, slug: `local/${name}`, cloneUrl: path.resolve(s) };
  }
  const m =
    s.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/) ?? s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error(`Not a GitHub repo URL: ${input}`);
  const owner = m[1];
  const name = m[2].replace(/\.git$/, "");
  return { owner, name, slug: `${owner}/${name}`, cloneUrl: `https://github.com/${owner}/${name}.git` };
}

export async function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<{ ok: boolean; code: number; stdout: string; stderr: string; timedOut: boolean }> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 120_000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, ...opts.env },
    });
    return { ok: true, code: 0, stdout, stderr, timedOut: false };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string; message?: string };
    return {
      ok: false,
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? "",
      timedOut: Boolean(err.killed && err.signal === "SIGTERM"),
    };
  }
}

// GITHUB_TOKEN from .env.local, falling back to the GitHub CLI's login.
export function githubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const t = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (t) process.env.GITHUB_TOKEN = t;
    return t || undefined;
  } catch {
    return undefined;
  }
}

// Basic-auth header so the token is never written to .git/config or echoed in a URL.
export function gitAuthArgs(): string[] {
  const token = githubToken();
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

// Shallow clone of our fork into a temp folder. Returns the local dir.
export async function cloneRepo(url: string): Promise<string> {
  const ref = parseRepo(url);
  const base = path.join(os.tmpdir(), "forewarned");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, `${ref.owner}-${ref.name}-`));
  const isLocal = ref.owner === "local";
  const args = [...(isLocal ? [] : gitAuthArgs()), "clone", "--depth", "1", isLocal ? `file://${ref.cloneUrl}` : ref.cloneUrl, dir];
  const r = await sh("git", args, { timeoutMs: 120_000 });
  if (!r.ok) throw new Error(`git clone failed for ${ref.slug}: ${r.stderr.replace(/basic [A-Za-z0-9+/=]+/g, "basic ***").trim()}`);
  // Keep installs and build output out of any commit we make, even if the repo has no .gitignore.
  await appendFile(path.join(dir, ".git", "info", "exclude"), "\nnode_modules/\n.next/\ndist/\ncoverage/\n");
  return dir;
}
