import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import { sh } from "./repo";
import { scanRepo } from "./scanner/scan";
import type { CheckResult, Verification } from "./types";

export interface Checks {
  tsc: CheckResult;
  tests: CheckResult;
  output: { tsc: string; tests: string }; // trimmed error output, fed back to the fix agent
  where: CheckRunner["where"];
}

// Runs shell commands from the repo root: on this machine, or inside a Freestyle VM (lib/sandbox.ts).
export interface CheckRunner {
  where: "local" | "freestyle";
  run(command: string, timeoutMs: number, env?: Record<string, string>): Promise<{ ok: boolean; output: string; timedOut: boolean }>;
  exists(relPath: string): Promise<boolean>;
}

export function localRunner(dir: string): CheckRunner {
  return {
    where: "local",
    async run(command, timeoutMs, env) {
      const r = await sh("sh", ["-c", command], { cwd: dir, timeoutMs, env });
      return { ok: r.ok, output: r.stdout + r.stderr, timedOut: r.timedOut };
    },
    async exists(relPath) {
      return existsSync(path.join(dir, relPath));
    },
  };
}

const NPM_DEFAULT_TEST = /no test specified/;
const NPM_FLAGS = "--no-audit --no-fund --loglevel=error";

export function tail(s: string, max = 6000): string {
  return s.length > max ? "…" + s.slice(-max) : s;
}

export async function installDeps(dir: string, runner: CheckRunner = localRunner(dir)): Promise<{ ok: boolean; output: string }> {
  if (!existsSync(path.join(dir, "package.json"))) return { ok: true, output: "no package.json" };
  const r = await runner.run(`npm install ${NPM_FLAGS}`, 240_000);
  return { ok: r.ok, output: tail(r.output, 3000) };
}

// Refresh package-lock.json for a version bump without installing anything or running any package scripts.
export async function updateLockfile(dir: string): Promise<{ ok: boolean; output: string }> {
  const r = await sh("npm", ["install", "--package-lock-only", "--ignore-scripts", ...NPM_FLAGS.split(" ")], { cwd: dir, timeoutMs: 120_000 });
  return { ok: r.ok, output: tail(r.stderr || r.stdout, 3000) };
}

// `tsc --noEmit` and `npm test`, 120 s each, "skipped" when missing.
export async function runChecks(dir: string, runner: CheckRunner = localRunner(dir)): Promise<Checks> {
  const out: Checks = { tsc: "skipped", tests: "skipped", output: { tsc: "", tests: "" }, where: runner.where };

  const hasTsconfig = existsSync(path.join(dir, "tsconfig.json"));
  if (hasTsconfig && (await runner.exists("node_modules/.bin/tsc"))) {
    const r = await runner.run("./node_modules/.bin/tsc --noEmit -p .", 120_000);
    out.tsc = r.ok ? "pass" : "fail";
    out.output.tsc = r.timedOut ? "tsc timed out after 120 s" : tail(r.output);
  } else if (hasTsconfig) {
    out.output.tsc = "typescript is not installed in this repo";
  }

  let testScript: string | undefined;
  try {
    testScript = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))?.scripts?.test;
  } catch {}
  if (testScript && !NPM_DEFAULT_TEST.test(testScript)) {
    const r = await runner.run("npm test --silent", 120_000, { CI: "true", FORCE_COLOR: "0", NO_COLOR: "1" });
    out.tests = r.ok ? "pass" : "fail";
    out.output.tests = r.timedOut ? "tests timed out after 120 s" : tail(r.output);
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
const resolveSpec = (fromFile: string, spec: string) => stripExt(path.normalize(path.join(path.dirname(fromFile), spec)));
const MOCK_RE = /\b(?:jest|vi)\.(?:do)?[mM]ock\(\s*["'`]([^"'`]+)["'`]/g;
// A skipped test still lets `npm test` pass, so files that can skip prove nothing.
const SKIP_RE = /\b(?:it|test|describe)\.(?:skip|skipIf|runIf|todo)\b|\b(?:xit|xtest|xdescribe)\s*\(/;

// Evidence that a passing test really runs a changed SDK call: the test imports, from a changed file,
// a function that contains an SDK call site (or calls a local helper that does), calls it, and mocks
// neither the SDK nor a repo module that uses it. Returns lines like "test/chat.test.ts calls ask() from src/chat.ts".
export async function exercisingTests(dir: string, filesChanged: string[], pkg: string | undefined): Promise<string[]> {
  const tests = await findTestFiles(dir);
  if (!tests.length) return [];
  const testKeys = new Set(tests.map(stripExt));
  const changed = new Set(filesChanged.map(stripExt));

  // Re-scan the patched code so line numbers reflect the new call sites.
  const inv = await scanRepo(dir, "verify");
  const deps = inv.dependencies.filter((d) => (pkg ? d.package === pkg : true));
  const sdkPackages = new Set(inv.dependencies.flatMap((d) => (d.package ? [d.package] : [])));
  const sdkFiles = new Set(deps.flatMap((d) => d.callSites.map((c) => stripExt(c.file))));
  const sitesByFile = new Map<string, { file: string; lines: number[] }>();
  for (const c of deps.flatMap((d) => d.callSites)) {
    const key = stripExt(c.file);
    if (c.kind === "import" || !changed.has(key) || testKeys.has(key)) continue;
    const e = sitesByFile.get(key) ?? { file: c.file, lines: [] };
    e.lines.push(c.line);
    sitesByFile.set(key, e);
  }
  if (!sitesByFile.size) return [];

  // Exported names in each changed file whose body holds a call site, directly or via a local helper.
  const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true } });
  const hotExports = new Map<string, Set<string>>();
  for (const [key, { file, lines }] of sitesByFile) {
    let sf;
    try {
      sf = project.addSourceFileAtPath(path.join(dir, file));
    } catch {
      continue;
    }
    const contains = (n: Node) => lines.some((l) => l >= n.getStartLineNumber() && l <= n.getEndLineNumber());
    const helpers = new Set<string>();
    for (const fn of [...sf.getFunctions(), ...sf.getVariableDeclarations()]) {
      const name = fn.getName();
      if (name && contains(fn)) helpers.add(name);
    }
    const callsHelper = (n: Node) => [...helpers].some((h) => new RegExp(`\\b${h}\\s*\\(`).test(n.getText()));
    const names = new Set<string>();
    for (const [name, decls] of sf.getExportedDeclarations()) {
      if (decls.some((d) => d.getSourceFile() === sf && (contains(d) || callsHelper(d)))) names.add(name);
    }
    if (names.size) hotExports.set(key, names);
  }
  if (!hotExports.size) return [];

  const evidence: string[] = [];
  for (const t of tests) {
    const src = await readFile(path.join(dir, t), "utf8");
    const mocked = [...src.matchAll(MOCK_RE)].map((m) => m[1]);
    const mocksSdk = mocked.some((spec) => sdkPackages.has(spec) || spec === pkg || (spec.startsWith(".") && sdkFiles.has(resolveSpec(t, spec))));
    if (mocksSdk || SKIP_RE.test(src)) continue;

    let sf;
    try {
      sf = project.createSourceFile(path.join(dir, `__verify__${t.replace(/[\\/]/g, "_")}`), src, { overwrite: true });
    } catch {
      continue;
    }
    const callable = new Map<string, { name: string; from: string }>(); // expression text -> export it reaches
    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!spec.startsWith(".") || imp.isTypeOnly()) continue;
      const key = resolveSpec(t, spec);
      const names = hotExports.get(key);
      if (!names) continue;
      const from = sitesByFile.get(key)!.file;
      const def = imp.getDefaultImport();
      if (def && names.has("default")) callable.set(def.getText(), { name: "default", from });
      for (const n of imp.getNamedImports()) {
        if (!n.isTypeOnly() && names.has(n.getName())) callable.set(n.getAliasNode()?.getText() ?? n.getName(), { name: n.getName(), from });
      }
      const ns = imp.getNamespaceImport();
      if (ns) for (const name of names) callable.set(`${ns.getText()}.${name}`, { name, from });
    }
    if (!callable.size) continue;
    for (const call of [...sf.getDescendantsOfKind(SyntaxKind.CallExpression), ...sf.getDescendantsOfKind(SyntaxKind.NewExpression)]) {
      const hit = callable.get(call.getExpression().getText());
      if (hit) {
        evidence.push(`${t} calls ${hit.name}() from ${hit.from}`);
        break;
      }
    }
  }
  return evidence;
}

// "tests-exercise-call" only when exercisingTests finds evidence and the tests passed;
// else "type-checked" if tsc passed; else "unverified".
export async function verificationLabel(
  dir: string,
  filesChanged: string[],
  pkg: string | undefined,
  after: Pick<Checks, "tsc" | "tests">,
): Promise<Verification> {
  const fallback: Verification = after.tsc === "pass" ? "type-checked" : "unverified";
  if (after.tests !== "pass" || after.tsc === "fail") return fallback;
  return (await exercisingTests(dir, filesChanged, pkg)).length ? "tests-exercise-call" : fallback;
}
