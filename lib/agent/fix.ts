import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { assertPushable, openOrUpdatePR } from "../github";
import { gitAuthArgs, parseRepo, sh } from "../repo";
import { runChecksIsolated, sandboxEnabled } from "../sandbox";
import { exercisingTests, installDeps, runChecks, updateLockfile, verificationLabel, type Checks } from "../verify";
import type { Alert, ChangeRecord, CheckResult, FixResult, Verification } from "../types";

const MAX_ATTEMPTS = 3; // first try + 2 retries
const AGENT_TIMEOUT_MS = 6 * 60_000;
const MODEL = "claude-opus-5-5";

export interface FixOptions {
  dryRun?: boolean; // patch and check locally, but don't push or open a PR
}

type AgentKind = "claude" | "codex" | "llm";

async function pickAgent(): Promise<AgentKind> {
  const forced = process.env.FOREWARNED_AGENT as AgentKind | undefined;
  if (forced === "claude" || forced === "codex" || forced === "llm") return forced;
  if ((await sh("claude", ["--version"], { timeoutMs: 10_000 })).ok) return "claude";
  if ((await sh("codex", ["--version"], { timeoutMs: 10_000 })).ok) return "codex";
  return "llm";
}

function buildPrompt(alert: Alert, change: ChangeRecord, previousErrors?: string): string {
  const sites = alert.callSites.map((s) => `- ${s.file}:${s.line}  ${s.symbol}  |  ${s.snippet}`).join("\n");
  return [
    `You are migrating this repository for a provider change. Edit files in place; do not run commands.`,
    ``,
    `Change: ${change.title} (${change.type}${change.effectiveDate ? `, effective ${change.effectiveDate}` : ""})`,
    `Provider: ${change.provider}`,
    `Source: ${change.sourceUrl}`,
    `Summary: ${change.summary}`,
    ``,
    `Migration instructions:`,
    change.migration,
    ``,
    `Affected call sites (file:line symbol | code):`,
    sites,
    ``,
    `Rules:`,
    `- Change only what the migration requires. Keep behaviour, names and exports the same.`,
    `- Update every affected call site listed above, plus any other usage of the same APIs you find in those files.`,
    change.affects.package
      ? `- If the migration requires a new package version, update "${change.affects.package}" in package.json (do not edit lockfiles; we reinstall).`
      : `- Do not change package.json unless the migration requires it.`,
    `- Keep the code type-correct for \`tsc --noEmit\`. Update existing tests only where they reference the old API.`,
    `- Do not add new dependencies, comments about the migration, or unrelated refactors.`,
    previousErrors
      ? `\nYour previous attempt failed these checks. Fix the errors:\n${previousErrors}`
      : ``,
  ].join("\n");
}

async function runClaude(dir: string, prompt: string): Promise<{ ok: boolean; output: string }> {
  const r = await sh(
    "claude",
    ["-p", prompt, "--permission-mode", "acceptEdits", "--allowedTools", "Read,Edit,Write,Glob,Grep", "--output-format", "text"],
    { cwd: dir, timeoutMs: AGENT_TIMEOUT_MS },
  );
  return { ok: r.ok, output: (r.stdout || r.stderr).trim().slice(-1500) };
}

async function runCodex(dir: string, prompt: string): Promise<{ ok: boolean; output: string }> {
  const r = await sh("codex", ["exec", "--full-auto", prompt], { cwd: dir, timeoutMs: AGENT_TIMEOUT_MS });
  return { ok: r.ok, output: (r.stdout || r.stderr).trim().slice(-1500) };
}

// Fallback: one direct LLM call per affected file, returning the whole rewritten file.
async function runLlm(dir: string, prompt: string, files: string[]): Promise<{ ok: boolean; output: string }> {
  const client = new Anthropic();
  const changed: string[] = [];
  for (const rel of files) {
    let original: string;
    try {
      original = await readFile(path.join(dir, rel), "utf8");
    } catch {
      continue;
    }
    const params = {
      model: MODEL,
      max_tokens: 64000,
      output_config: { effort: "medium" as const },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user" as const,
          content: `${prompt}\n\nRewrite this one file: ${rel}\nReturn the complete new file contents between <file> and </file>, nothing else. If the file needs no change, return it unchanged.\n\n<file>\n${original}\n</file>`,
        },
      ],
    };
    const msg = await client.beta.messages.stream(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming).finalMessage();
    if (msg.stop_reason === "refusal") return { ok: false, output: `model declined to rewrite ${rel}` };
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const body = text.match(/<file>\n?([\s\S]*?)\n?<\/file>/)?.[1];
    if (body === undefined) return { ok: false, output: `no <file> block returned for ${rel}` };
    const next = original.endsWith("\n") && !body.endsWith("\n") ? body + "\n" : body;
    if (next !== original) {
      await writeFile(path.join(dir, rel), next);
      changed.push(rel);
    }
  }
  return { ok: true, output: changed.length ? `rewrote ${changed.join(", ")}` : "no files changed" };
}

async function changedFiles(dir: string): Promise<string[]> {
  const r = await sh("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir });
  return r.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"|"$/g, "").split(" -> ").pop()!)
    .filter((f) => !f.startsWith("node_modules/"));
}

function checkErrors(c: Checks, before: Checks): string {
  const parts: string[] = [];
  if (c.tsc === "fail") parts.push(`tsc --noEmit failed:\n${c.output.tsc}`);
  if (c.tests === "fail" && before.tests !== "fail") parts.push(`npm test failed (it passed before your change):\n${c.output.tests}`);
  return parts.join("\n\n");
}

const LABEL_TEXT: Record<Verification, string> = {
  "tests-exercise-call": "A passing test calls a function containing a changed SDK call, without mocking the SDK:",
  "type-checked": "`tsc --noEmit` passed. No passing test calls the changed code without mocking the SDK, so runtime behaviour is not proven.",
  unverified: "Neither the type check nor an exercising test passed. Review carefully.",
};

function prBody(alert: Alert, change: ChangeRecord, r: FixResult, evidence: string[], checksWhere: Checks["where"]): string {
  const icon = (c: CheckResult) => (c === "pass" ? "✅ pass" : c === "fail" ? "❌ fail" : "➖ skipped");
  return [
    `## ${change.title}`,
    ``,
    change.summary,
    ``,
    `**Source:** ${change.sourceUrl}`,
    change.effectiveDate ? `**Deadline:** ${change.effectiveDate}` : ``,
    ``,
    `### Call sites touched`,
    ...alert.callSites.map((s) => `- \`${s.file}:${s.line}\` — \`${s.symbol}\``),
    ``,
    `### Files changed`,
    ...r.filesChanged.map((f) => `- \`${f}\``),
    ``,
    `### Checks`,
    `| Check | Before | After |`,
    `|---|---|---|`,
    ...r.checks.map((c) => `| ${c.name === "tsc" ? "`tsc --noEmit`" : "`npm test`"} | ${icon(c.before)} | ${icon(c.after)} |`),
    ``,
    checksWhere === "freestyle"
      ? `Install, type check and tests ran in an isolated [Freestyle](https://freestyle.sh) VM, not on our machine.`
      : `Checks ran locally.`,
    ``,
    `### Verification: \`${r.verification}\``,
    LABEL_TEXT[r.verification],
    ...evidence.map((e) => `- ${e}`),
    ``,
    `Attempts: ${r.attempts}`,
    ``,
    `---`,
    `_Opened by Forewarned: we tell you what's about to break, before it happens._`,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}

export async function fixAlert(
  alert: Alert,
  change: ChangeRecord,
  dir: string,
  onLog: (step: string) => void = () => {},
  opts: FixOptions = {},
): Promise<FixResult> {
  const branch = `forewarned/${change.id}`;
  const result: FixResult = {
    alertId: alert.id,
    branch,
    filesChanged: [],
    checks: [],
    verification: "unverified",
    attempts: 0,
    log: [],
  };
  const log = (step: string) => {
    result.log.push(step);
    onLog(step);
  };

  try {
    const ref = parseRepo(alert.repo);
    const pushing = !opts.dryRun && ref.owner !== "local";
    let base = "main";
    if (pushing) {
      log(`Checking we own ${ref.slug}`);
      base = (await assertPushable(ref)).defaultBranch;
    }

    // Sandbox mode: the repo's install scripts, tsc and tests run only inside a Freestyle VM, never here.
    const sandbox = sandboxEnabled();
    const where = sandbox ? " in an isolated Freestyle VM" : "";
    const check = () => (sandbox ? runChecksIsolated(dir, log) : runChecks(dir));
    if (!sandbox) {
      log("Installing dependencies");
      const inst = await installDeps(dir);
      if (!inst.ok) log(`npm install reported errors: ${inst.output.split("\n")[0]}`);
    }

    log(`Running checks before the change${where} (tsc, tests)`);
    const before = await check();
    log(`Before: tsc ${before.tsc}, tests ${before.tests}`);

    await sh("git", ["checkout", "-B", branch], { cwd: dir });
    log(`Created branch ${branch}`);

    const agent = await pickAgent();
    const files = [...new Set(alert.callSites.map((s) => s.file))];
    if (change.affects.package) files.push("package.json");

    let after: Checks = before;
    let previousErrors: string | undefined;
    let passed = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      result.attempts = attempt;
      log(
        attempt === 1
          ? `Patching ${alert.callSites.length} call site${alert.callSites.length === 1 ? "" : "s"} in ${files.filter((f) => f !== "package.json").length} file(s) with ${agent === "llm" ? MODEL : agent}`
          : `Retry ${attempt - 1} of ${MAX_ATTEMPTS - 1}: sending the errors back to the agent`,
      );
      const prompt = buildPrompt(alert, change, previousErrors);
      const run = agent === "claude" ? await runClaude(dir, prompt) : agent === "codex" ? await runCodex(dir, prompt) : await runLlm(dir, prompt, files);
      if (!run.ok) log(`Agent reported a problem: ${run.output.split("\n").slice(-1)[0]}`);

      result.filesChanged = await changedFiles(dir);
      if (!result.filesChanged.length) {
        previousErrors = "You did not change any files. Apply the migration to the listed call sites.";
        log("Agent made no changes");
        continue;
      }
      log(`Changed ${result.filesChanged.join(", ")}`);

      const pkgChanged = (await sh("git", ["diff", "--quiet", "HEAD", "--", "package.json"], { cwd: dir })).code !== 0;
      if (pkgChanged) {
        log(sandbox ? "package.json changed, updating the lockfile (no package scripts run locally)" : "package.json changed, reinstalling dependencies");
        const r = sandbox ? await updateLockfile(dir) : await installDeps(dir);
        if (!r.ok) log(`npm reported errors: ${r.output.split("\n")[0]}`);
        result.filesChanged = await changedFiles(dir);
      }

      log(`Running checks after the change${where} (tsc, tests)`);
      after = await check();
      log(`After: tsc ${after.tsc}, tests ${after.tests}`);

      const typeOk = after.tsc === "pass" || (after.tsc === "skipped" && after.tests !== "fail");
      const testsRegressed = before.tests === "pass" && after.tests === "fail";
      if (typeOk && !testsRegressed) {
        passed = true;
        break;
      }
      previousErrors = checkErrors(after, before);
      if (typeOk && attempt === MAX_ATTEMPTS) passed = true; // tsc passes; the test regression is reported honestly below
    }

    result.checks = [
      { name: "tsc", before: before.tsc, after: after.tsc },
      { name: "tests", before: before.tests, after: after.tests },
    ];
    result.verification = await verificationLabel(dir, result.filesChanged, change.affects.package, after);
    const evidence = result.verification === "tests-exercise-call" ? await exercisingTests(dir, result.filesChanged, change.affects.package) : [];

    if (!passed) {
      log(`Failed: the type check still fails after ${result.attempts} attempts. No PR opened.`);
      return result;
    }
    log(`Verification: ${result.verification}${evidence.length ? ` (${evidence.join("; ")})` : ""}`);

    await sh("git", ["add", "-A", "--", ...result.filesChanged], { cwd: dir });
    const commit = await sh(
      "git",
      ["-c", "user.name=Forewarned", "-c", "user.email=forewarned@users.noreply.github.com", "commit", "-m", `${change.title}\n\nSource: ${change.sourceUrl}\nVerification: ${result.verification}`],
      { cwd: dir },
    );
    if (!commit.ok) throw new Error(`git commit failed: ${commit.stderr.trim()}`);
    log("Committed the migration");

    if (!pushing) {
      log(opts.dryRun ? "Dry run: skipping push and PR" : "Local repo: skipping push and PR");
      return result;
    }

    log(`Pushing ${branch} to ${ref.slug}`);
    const push = await sh("git", [...gitAuthArgs(), "push", "--force", "origin", `HEAD:refs/heads/${branch}`], { cwd: dir, timeoutMs: 120_000 });
    if (!push.ok) throw new Error(`git push failed: ${push.stderr.replace(/basic [A-Za-z0-9+/=]+/g, "basic ***").trim().split("\n").slice(-2).join(" ")}`);

    log("Opening the pull request");
    result.prUrl = await openOrUpdatePR(ref, {
      branch,
      base,
      title: `[Forewarned] ${change.title}`,
      body: prBody(alert, change, result, evidence, after.where),
      labels: ["forewarned", `verified: ${result.verification}`],
    });
    log(`PR opened: ${result.prUrl}`);
    return result;
  } catch (e) {
    log(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }
}
