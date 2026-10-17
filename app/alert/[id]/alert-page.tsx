"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Alert, ChangeRecord, FixResult, Verification } from "@/lib/types";

interface AlertPayload {
  alert: Alert;
  change: ChangeRecord;
  repo: string;
  pr?: { number: number; url: string }; // our currently open PR for this alert, if any
}

type Job = FixResult & { status: "running" | "done" | "failed" };

const VERIFICATION_LABEL: Record<Verification, { text: string; title: string }> = {
  "tests-exercise-call": { text: "Verified: Tests exercise the call", title: "A passing test calls the changed SDK code without mocking it" },
  "type-checked": { text: "Verified: Type-checked", title: "tsc passes; no test exercises the changed call, so runtime behaviour is not proven" },
  unverified: { text: "Unverified", title: "Neither the type check nor an exercising test passed" },
};

function lineIcon(line: string): { icon: string; className: string } {
  if (line.startsWith("Failed")) return { icon: "✗", className: "text-rose-400" };
  if (/^(Retry|Agent reported|npm reported|npm install reported|Freestyle unavailable)/.test(line)) return { icon: "!", className: "text-amber-400" };
  return { icon: "✓", className: "text-emerald-400" };
}

export default function AlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const dryRun = useSearchParams().get("dryRun") === "1"; // rehearsal: patch and check, but don't push or open a PR
  const [data, setData] = useState<AlertPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`/api/alerts/${id}`)
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok) throw new Error(payload.error ?? "Failed to load alert");
        setData(payload);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [id]);

  const status: "idle" | "running" | "done" | "failed" = starting ? "running" : job?.status ?? "idle";
  const log = startError ? [`Failed: ${startError}`] : job?.log ?? (starting ? ["Starting fix job..."] : []);
  const prUrl = job?.prUrl;

  async function triggerFix() {
    if (!data || status === "running") return;
    setStarting(true);
    setStartError(null);
    setJob(null);
    try {
      const res = await fetch(`/api/alerts/${id}/fix${dryRun ? "?dryRun=1" : ""}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to start fix");
      const jobId: string = body.jobId;
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(async () => {
        const jr = await fetch(`/api/jobs/${jobId}`);
        if (!jr.ok) return;
        const next: Job = await jr.json();
        setJob(next);
        setStarting(false);
        if (next.status !== "running" && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      }, 1000);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="font-mono text-rose-400">{loadError}</p>
        <Link href="/" className="mt-4 inline-block font-mono text-sm text-teal-400 underline">
          ← Back to Connect
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 font-mono text-zinc-400">
        Loading alert...
      </main>
    );
  }

  const { alert, change } = data;
  const repoSlugId = alert.repo.replace("/", "__");

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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-mono text-sm font-semibold text-zinc-300">
              Affected call sites ({alert.callSites.length})
            </h2>
            <button
              type="button"
              onClick={triggerFix}
              disabled={status === "running"}
              className="h-11 rounded-lg bg-teal-500 px-5 font-semibold text-zinc-950 hover:opacity-90 disabled:opacity-50"
            >
              {status === "running" ? "Fixing..." : change.type === "feature" ? "Open opportunity PR" : "Open fix PR"}
            </button>
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

      {data.pr && !job && !starting && (
        <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-6 py-4 font-mono text-sm text-emerald-200">
          A Forewarned PR for this change is already open:{" "}
          <a href={data.pr.url} target="_blank" rel="noopener noreferrer" className="font-bold underline">
            #{data.pr.number}
          </a>
          . Running the fix again updates it.
        </div>
      )}

      {log.length > 0 && (
        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="mb-4 text-lg font-bold text-zinc-100">Live progress</h2>
          <div className="space-y-2 font-mono text-sm">
            {log.map((line, i) => {
              const { icon, className } = lineIcon(line);
              return (
                <div key={i} className="flex items-start gap-3">
                  <span className={className}>{icon}</span>
                  <span className={line.startsWith("Failed") ? "text-rose-300" : "text-zinc-300"}>{line}</span>
                </div>
              );
            })}
            {status === "running" && <div className="pl-6 text-zinc-500">…</div>}
          </div>
        </div>
      )}

      {job && status !== "running" && job.checks.length > 0 && (
        <div className="rounded-xl border border-teal-500/50 bg-zinc-950 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {prUrl ? (
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-2xl font-bold text-teal-400 hover:underline"
              >
                PR #{prUrl.split("/").pop()} opened on GitHub →
              </a>
            ) : (
              <span className="text-2xl font-bold text-zinc-300">
                {status === "failed" ? "No PR opened" : "Checked (dry run, no PR)"}
              </span>
            )}
            <span
              title={VERIFICATION_LABEL[job.verification].title}
              className="rounded border border-teal-500/40 bg-teal-500/15 px-3 py-1 font-mono text-xs font-bold text-teal-300"
            >
              {VERIFICATION_LABEL[job.verification].text}
            </span>
          </div>
          <p className="mt-3 font-mono text-sm text-zinc-400">
            {job.checks.map((c) => `${c.name} ${c.before} → ${c.after}`).join(" · ")} ·{" "}
            {job.log.some((l) => l.startsWith("Freestyle VM ready")) ? "Freestyle isolated VM" : "checks ran locally"} ·{" "}
            {job.attempts} attempt{job.attempts === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </main>
  );
}
