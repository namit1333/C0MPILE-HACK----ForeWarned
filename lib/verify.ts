import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { sh } from "./repo";
import type { CheckResult, Verification } from "./types";

export interface Checks {
  tsc: CheckResult;
  tests: CheckResult;
  output: { tsc: string; tests: string }; // trimmed error output, fed back to the fix agent
}

const NPM_DEFAULT_TEST = /no test specified/;

function tail(s: string, max = 6000): string {
  return s.length > max ? "…" + s.slice(-max) : s;
}

export async function installDeps(dir: string): Promise<{ ok: boolean; output: string }> {
  if (!existsSync(path.join(dir, "package.json"))) return { ok: true, output: "no package.json" };
  const r = await sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, timeoutMs: 240_000 });
  return { ok: r.ok, output: tail(r.stderr || r.stdout, 3000) };
}

// `npx tsc --noEmit` and `npm test`, 120 s each, "skipped" when missing.
export async function runChecks(dir: string): Promise<Checks> {
  const out: Checks = { tsc: "skipped", tests: "skipped", output: { tsc: "", tests: "" } };

  const hasTsconfig = existsSync(path.join(dir, "tsconfig.json"));
  const localTsc = path.join(dir, "node_modules", ".bin", "tsc");
  if (hasTsconfig && existsSync(localTsc)) {
    const r = await sh(localTsc, ["--noEmit", "-p", "."], { cwd: dir, timeoutMs: 120_000 });
    out.tsc = r.ok ? "pass" : "fail";
    out.output.tsc = r.timedOut ? "tsc timed out after 120 s" : tail(r.stdout + r.stderr);
  } else if (hasTsconfig) {
    out.output.tsc = "typescript is not installed in this repo";
  }

  let testScript: string | undefined;
  try {
    testScript = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))?.scripts?.test;
  } catch {}
  if (testScript && !NPM_DEFAULT_TEST.test(testScript)) {
    const r = await sh("npm", ["test", "--silent"], { cwd: dir, timeoutMs: 120_000, env: { CI: "true", FORCE_COLOR: "0" } });
    out.tests = r.ok ? "pass" : "fail";
    out.output.tests = r.timedOut ? "tests timed out after 120 s" : tail(r.stdout + r.stderr);
  }
  return out;
}

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)__tests__\//;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);

async function findTestFiles(dir: string, root = dir, out: string[] = []): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) await findTestFiles(abs, root, out);
    } else if (TEST_FILE.test(path.relative(root, abs)) && /\.[cm]?[jt]sx?$/.test(ent.name)) {
      out.push(path.relative(root, abs));
    }
  }
  return out;
}

const stripExt = (p: string) => p.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");

// "tests-exercise-call" only if a passing test imports a changed file and doesn't mock the SDK;
// else "type-checked" if tsc passed; else "unverified".
export async function verificationLabel(
  dir: string,
  filesChanged: string[],
  pkg: string | undefined,
  after: Pick<Checks, "tsc" | "tests">,
): Promise<Verification> {
  if (after.tests === "pass" && after.tsc !== "fail") {
    const changed = new Set(filesChanged.map(stripExt));
    const mockRe = pkg
      ? new RegExp(`(jest|vi)\\.(do)?[mM]ock\\(\\s*["'\`]${pkg.replace(/[/@.]/g, (c) => `\\${c}`)}["'\`]`)
      : null;
    for (const t of await findTestFiles(dir)) {
      const src = await readFile(path.join(dir, t), "utf8");
      if (mockRe?.test(src)) continue;
      const specs = [...src.matchAll(/(?:from\s+|import\(\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
      const hits = specs.some((s) => changed.has(stripExt(path.normalize(path.join(path.dirname(t), s)))));
      if (hits) return "tests-exercise-call";
    }
  }
  return after.tsc === "pass" ? "type-checked" : "unverified";
}
