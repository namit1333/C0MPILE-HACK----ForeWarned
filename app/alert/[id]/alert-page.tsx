"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Alert, ChangeRecord, FixResult, Verification } from "@/lib/types";

interface AlertPayload {
  alert: Alert;
  change: ChangeRecord;
  repo: string;
  pr?: { number: number; url: string; verification?: Verification }; // our open PR for this alert, live from GitHub
}

type Job = FixResult & { status: "running" | "done" | "failed" };

const VERIFICATION_BADGE: Record<Verification, { text: string; title: string }> = {
  "tests-exercise-call": { text: "Verified: Tests exercise the call", title: "A passing test calls the changed SDK code without mocking it" },
  "type-checked": { text: "Verified: Type-checked", title: "The type checker passed in an isolated Freestyle VM" },
  unverified: { text: "Unverified", title: "Neither the type check nor an exercising test passed" },
};

// Pre-baked demo results when GitHub has no open PR yet. Live jobs override these.
const DEMO_PRS: Record<string, { prUrl: string; verification: Verification; log: string[] }> = {
  "openai-legacy-models-2026-10-23": {
    prUrl: "https://github.com/A5bhinav/openai-api-example/pull/3",
    verification: "type-checked",
    log: [
      "Cloning A5bhinav/openai-api-example",
      "Freestyle VM ready (1.8s)",
      "Running checks before the change in an isolated Freestyle VM (tsc, tests)",
      "Before: tsc pass, tests skipped",
      "Created branch forewarned/openai-legacy-models-2026-10-23",
      "Patching 1 call site in 1 file(s) with claude-opus-5-5",
      "Changed src/commands/chat.ts",
      "Running checks after the change in an isolated Freestyle VM (tsc, tests)",
      "After: tsc pass, tests skipped",
      "Verification: type-checked",
      "PR opened: https://github.com/A5bhinav/openai-api-example/pull/3",
    ],
  },
  "openai-node-v4": {
    prUrl: "https://github.com/A5bhinav/openai-api-example/pull/4",
    verification: "type-checked",
    log: [
      "Cloning A5bhinav/openai-api-example",
      "Freestyle VM ready (1.9s)",
      "Running checks before the change in an isolated Freestyle VM (tsc, tests)",
      "Before: tsc pass, tests skipped",
      "Created branch forewarned/openai-node-v4",
      "Patching 5 call sites in 3 file(s) with claude-opus-5-5",
      "Changed package.json, src/app.ts, src/commands/chat.ts, src/commands/image.ts",
      "Running checks after the change in an isolated Freestyle VM (tsc, tests)",
      "After: tsc pass, tests skipped",
      "Verification: type-checked",
      "PR opened: https://github.com/A5bhinav/openai-api-example/pull/4",
    ],
  },
  "openai-responses-api": {
    prUrl: "https://github.com/A5bhinav/openai-api-example/pull/5",
    verification: "type-checked",
    log: [
      "Cloning A5bhinav/openai-api-example",
      "Building on #4 (forewarned/openai-node-v4) so this PR shows only the new feature",
      "Freestyle VM ready (1.7s)",
      "Running checks before the change in an isolated Freestyle VM (tsc, tests)",
      "Before: tsc pass, tests skipped",
      "Created branch forewarned/openai-responses-api",
      "Patching 1 call site in 1 file(s) with claude-opus-5-5",
      "Changed src/commands/chat.ts",
      "Running checks after the change in an isolated Freestyle VM (tsc, tests)",
      "After: tsc pass, tests skipped",
      "Verification: type-checked",
      "PR opened: https://github.com/A5bhinav/openai-api-example/pull/5",
    ],
  },
};

export default function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<AlertPayload | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [prUrl, setPrUrl] = useState<string | undefined>(undefined);
  const [job, setJob] = useState<Job | null>(null);
  const [verification, setVerification] = useState<Verification | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dryRun = useSearchParams().get("dryRun") === "1"; // rehearsal: patch and check without pushing or opening a PR

  useEffect(() => {
    fetch(`/api/alerts/${id}`)
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok) throw new Error(payload.error ?? "Failed to load alert");
        return payload as AlertPayload;
      })
      .then((payload) => {
        setData(payload);
        // A PR for this change is already open on GitHub: show it.
        if (payload.pr) {
          setPrUrl(payload.pr.url);
          setVerification(payload.pr.verification);
          setStatus("done");
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [id]);

  async function triggerFix() {
    if (!data) return;
    setLive(true);
    setStatus("running");
    setLog(["Starting fix job..."]);
    setJob(null);
    setPrUrl(undefined);
    setVerification(undefined);

    const res = await fetch(`/api/alerts/${id}/fix${dryRun ? "?dryRun=1" : ""}`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setStatus("failed");
      setLog((prev) => [...prev, body.error ?? "Failed to start fix"]);
      return;
    }

    const jobId = body.jobId;
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      if (!jr.ok) return;
      const next: Job = await jr.json();
      setLog(next.log);
      if (next.status !== "running") {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setJob(next);
        setVerification(next.verification);
        setStatus(next.status);
        setPrUrl(next.prUrl);
      }
    }, 1000);
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 font-mono text-zinc-400">
        {loadError ? <span className="text-rose-400">{loadError}</span> : "Loading alert..."}
      </main>
    );
  }

  const { alert, change } = data;
  const repoSlugId = alert.repo.replace("/", "__");
  const demo = DEMO_PRS[change.id];
  const showDemoHint = !live && status === "done" && Boolean(demo) && !job;

  function showDemoResult() {
    if (!demo || live || status === "running") return;
    setLog(demo.log);
    setPrUrl(demo.prUrl);
    setVerification(demo.verification);
    setStatus("done");
    setJob(null);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <Link
        href={`/repo/${repoSlugId}`}
        className="mb-6 inline-block font-mono text-sm text-zinc-400 hover:text-teal-400"
      >
        ← Back to {alert.repo}
      </Link>

      <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded border border-rose-500/40 bg-rose-500/15 px-2.5 py-0.5 font-mono text-xs font-bold uppercase text-rose-300">
            {change.type}
          </span>
          <a
            href={change.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-teal-400 hover:underline"
          >
            Source page →
          </a>
        </div>
        <h1 className="mb-2 text-3xl font-bold text-zinc-50">{change.title}</h1>
        <p className="text-base text-zinc-400">{change.summary}</p>

        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-mono text-sm font-semibold text-zinc-300">
              Affected call sites ({alert.callSites.length})
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              {demo && status === "idle" && (
                <button
                  type="button"
                  onClick={showDemoResult}
                  className="font-mono text-xs text-zinc-500 underline hover:text-teal-400"
                >
                  Show demo result
                </button>
              )}
              <button
                type="button"
                onClick={triggerFix}
                disabled={status === "running"}
                className="h-11 rounded-lg bg-teal-500 px-5 font-semibold text-zinc-950 hover:opacity-90 disabled:opacity-50"
              >
                {status === "running" ? "Fixing..." : status === "done" && prUrl ? "Re-run fix PR" : "Open fix PR"}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {alert.callSites.map((s, idx) => (
              <div
                key={`${s.file}:${s.line}:${idx}`}
                className="rounded-lg border border-zinc-800 bg-black p-3 font-mono text-xs"
              >
                <div className="mb-1 flex justify-between text-teal-400">
                  <span>
                    {s.file}:{s.line}
                  </span>
                  <span className="text-zinc-300">{s.symbol}</span>
                </div>
                <div className="overflow-x-auto whitespace-pre text-zinc-400">{s.snippet}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {log.length > 0 && (
        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-zinc-100">
              {live || status === "running" ? "Live progress" : "Progress"}
            </h2>
            {showDemoHint && (
              <span className="font-mono text-xs text-zinc-500">Demo result · click Open fix PR to run live</span>
            )}
          </div>
          <div className="space-y-2 font-mono text-sm">
            {log.map((line, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={line.startsWith("Failed") ? "text-rose-400" : status === "running" && i === log.length - 1 ? "text-teal-400" : "text-emerald-400"}>
                  {line.startsWith("Failed") ? "✗" : status === "running" && i === log.length - 1 ? "◌" : "✓"}
                </span>
                <span className="text-zinc-300">{line}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {status === "done" && prUrl && (
        <div className="rounded-xl border border-teal-500/50 bg-zinc-950 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-2xl font-bold text-teal-400 hover:underline"
            >
              PR opened on GitHub →
            </a>
            {verification && (
              <span
                title={VERIFICATION_BADGE[verification].title}
                className="rounded border border-teal-500/40 bg-teal-500/15 px-3 py-1 font-mono text-xs font-bold text-teal-300"
              >
                {VERIFICATION_BADGE[verification].text}
              </span>
            )}
          </div>
          {job ? (
            <p className="mt-3 font-mono text-sm text-zinc-400">
              {job.checks.filter((c) => c.name === "tsc").map((c) => `tsc ${c.before} → ${c.after}`)[0] ?? "tsc skipped"} ·{" "}
              {job.log.some((l) => l.startsWith("Freestyle VM ready")) ? "Freestyle isolated VM" : "local checks"} ·{" "}
              {job.attempts} attempt{job.attempts === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="mt-3 font-mono text-sm text-zinc-400">
              tsc pass → pass · Freestyle isolated VM · 1 attempt
            </p>
          )}
        </div>
      )}

      {status === "failed" && (
        <div className="rounded-xl border border-rose-500/40 bg-zinc-950 p-6">
          <p className="text-lg font-bold text-rose-300">Fix failed</p>
          <p className="mt-2 font-mono text-sm text-zinc-400">
            Check GITHUB_TOKEN, agent access, and that the repo is a fork you can push to.
          </p>
        </div>
      )}
    </main>
  );
}
