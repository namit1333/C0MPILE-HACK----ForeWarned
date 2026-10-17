// Run a repo's install, type check and tests inside an ephemeral Freestyle VM instead of on this machine.
// Enabled with FOREWARNED_SANDBOX=freestyle (needs FREESTYLE_API_KEY). Falls back to local checks on any Freestyle error.
import { openAsBlob } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Freestyle as FreestyleClient } from "freestyle";
import { sh } from "./repo";
import { installDeps, runChecks, type CheckRunner, type Checks } from "./verify";

const WORK = "/tmp/work";

export function sandboxEnabled(): boolean {
  return process.env.FOREWARNED_SANDBOX === "freestyle" && Boolean(process.env.FREESTYLE_API_KEY);
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

async function checksInVm(dir: string, onLog: (s: string) => void): Promise<Checks> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "forewarned-tar-"));
  const tarball = path.join(tmp, "repo.tgz");
  const t0 = Date.now();
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  // freestyle is ESM-only; a dynamic import works from both tsx (CJS) and Next.js.
  const { Freestyle } = await import("freestyle");
  const freestyle: FreestyleClient = new Freestyle();
  let vm: Awaited<ReturnType<FreestyleClient["vms"]["create"]>>["vm"] | undefined;
  try {
    const tar = await sh("tar", ["-czf", tarball, "--exclude=./node_modules", "--exclude=./.git", "-C", dir, "."], { env: { COPYFILE_DISABLE: "1" } });
    if (!tar.ok) throw new Error(`tar failed: ${tar.stderr.trim()}`);

    ({ vm } = await freestyle.vms.create({
      // Outbound internet only, so npm can reach the registry.
      firewall: { rules: [{ action: "allow", source: {}, destination: { public: true } }] },
      displayName: "forewarned-checks",
      autoDeleteSeconds: 0, // ephemeral: deleted as soon as it stops
      ttlSeconds: 900, // hard deadline in case we never get to delete it
    }));
    onLog(`Freestyle VM ready (${secs()})`);
    await vm.fs.writeFile("/tmp/repo.tgz", await openAsBlob(tarball));
    const untar = await vm.exec(`mkdir -p ${WORK} && tar -xzf /tmp/repo.tgz -C ${WORK}`);
    if (untar.statusCode !== 0) throw new Error(`untar failed in VM: ${untar.stderr ?? ""}`);

    const box = vm;
    const runner: CheckRunner = {
      where: "freestyle",
      async run(command, timeoutMs, env) {
        const r = await box.exec({ command: `cd ${WORK} && ${command}`, timeoutMs: Math.min(timeoutMs, 300_000), env });
        return { ok: r.statusCode === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`, timedOut: r.statusCode === null };
      },
      async exists(relPath) {
        const r = await box.exec(`test -e ${shellQuote(path.posix.join(WORK, relPath))}`);
        return r.statusCode === 0;
      },
    };

    const inst = await installDeps(dir, runner);
    onLog(inst.ok ? `npm install in VM done (${secs()})` : `npm install in VM reported errors: ${inst.output.split("\n")[0]}`);
    const checks = await runChecks(dir, runner);
    onLog(`Checks finished in the Freestyle VM (${secs()})`);
    return checks;
  } finally {
    await vm?.delete().catch(() => {});
    await rm(tmp, { recursive: true, force: true });
  }
}

// Same contract as runChecks; the repo's code never runs on this machine unless Freestyle fails.
export async function runChecksIsolated(dir: string, onLog: (s: string) => void): Promise<Checks> {
  try {
    return await checksInVm(dir, onLog);
  } catch (e) {
    onLog(`Freestyle unavailable (${e instanceof Error ? e.message.split("\n")[0] : String(e)}); running checks locally instead`);
    await installDeps(dir);
    return runChecks(dir);
  }
}
