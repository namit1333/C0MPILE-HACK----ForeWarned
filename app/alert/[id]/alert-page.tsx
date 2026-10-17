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

const TYPE_STYLE: Record<ChangeRecord["type"], { label: string; dot: string }> = {
  deprecation: { label: "Shutdown", dot: "bg-amber-400" },
  breaking: { label: "Breaking", dot: "bg-red-500" },
  feature: { label: "New feature", dot: "bg-sky-400" },
};

function formatDeadline(dateStr?: string): string | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - now.getTime()) / 86_400_000);
  const label = target.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const rel = days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : `${-days} days ago`;
  return `${rel} · ${label}`;
}

const VERIFICATION_BADGE: Record<Verification, { text: string; title: string }> = {
  "tests-exercise-call": { text: "Tests exercise the call", title: "A passing test calls the changed SDK code without mocking it" },
  "type-checked": { text: "Type-checked", title: "The type checker passed in an isolated Freestyle VM" },
  unverified: { text: "Unverified", title: "Neither the type check nor an exercising test passed" },
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
    setStatus("running");
    setLog(["Starting fix job..."]);
    setJob(null);
    setPrUrl(undefined);

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
      <main className="mx-auto w-full max-w-6xl px-6 py-16 text-sm text-zinc-500">
        {loadError ? <span className="text-red-400">{loadError}</span> : "Loading alert…"}
      </main>
    );
  }

  const { alert, change } = data;
  const repoSlugId = alert.repo.replace("/", "__");
  const t = TYPE_STYLE[change.type];
  const due = formatDeadline(change.effectiveDate);
  const isFeature = change.type === "feature";
  const ranInFreestyle = job?.log.some((l) => l.startsWith("Freestyle VM ready"));
  const tsc = job?.checks.find((c) => c.name === "tsc");
  const feedState =
    status === "running"
      ? { label: "Running", dot: "animate-pulse bg-amber-400" }
      : status === "failed"
        ? { label: "Failed", dot: "bg-red-500" }
        : { label: "Done", dot: "bg-emerald-400" };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="border-b border-white/[0.08] pb-8">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Link href={`/repo/${repoSlugId}`} className="font-mono text-zinc-400 hover:text-white">
            {alert.repo}
          </Link>
          <span className="text-zinc-700">/</span>
          <span>{t.label.toLowerCase()}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-zinc-300">
            <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
            {t.label}
          </span>
          {due && <span className="font-mono text-xs text-amber-300/90">{due}</span>}
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">{change.title}</h1>
        <p className="mt-3 max-w-3xl text-base leading-relaxed text-zinc-400">{change.summary}</p>
        <a
          href={change.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm text-zinc-400 underline decoration-zinc-700 underline-offset-4 hover:text-white hover:decoration-zinc-400"
        >
          Provider source ↗
        </a>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Call sites */}
        <section className="min-w-0 lg:col-span-5">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            Affected call sites <span className="text-zinc-600">{alert.callSites.length}</span>
          </h2>
          <ul className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0a0a]">
            {alert.callSites.map((s, idx) => (
              <li key={`${s.file}:${s.line}:${idx}`} className="border-b border-white/[0.06] px-4 py-3 last:border-b-0">
                <p className="truncate font-mono text-xs text-zinc-400">
                  {s.file}
                  <span className="text-zinc-600">:{s.line}</span>
                </p>
                <code className="mt-1.5 block overflow-x-auto whitespace-pre font-mono text-xs text-zinc-200">{s.snippet}</code>
              </li>
            ))}
          </ul>
        </section>

        {/* Fix */}
        <section className="min-w-0 space-y-4 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#0a0a0a] p-5">
            <div>
              <h2 className="text-sm font-medium text-white">{isFeature ? "Opportunity PR" : "Fix PR"}</h2>
              <p className="mt-1 text-sm text-zinc-500">Patch, type-check in an isolated sandbox, open a PR on {alert.repo}.</p>
              {dryRun && <p className="mt-1 font-mono text-xs text-sky-400">dry run · no push, no PR</p>}
            </div>
            <button
              type="button"
              onClick={triggerFix}
              disabled={status === "running"}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md bg-white px-4 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {status === "running" && <span className="h-3 w-3 animate-spin rounded-full border-2 border-black border-r-transparent" />}
              {status === "running" ? "Fixing…" : isFeature ? "Open opportunity PR" : "Open fix PR"}
            </button>
          </div>

          {log.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black">
              <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#0a0a0a] px-4 py-2.5">
                <span className="text-xs font-medium text-zinc-400">Logs</span>
                <span className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${feedState.dot}`} />
                  {feedState.label}
                </span>
              </div>
              <ol className="max-h-[420px] overflow-y-auto py-3 font-mono text-[12.5px] leading-6">
                {log.map((line, i) => {
                  const failed = line.startsWith("Failed");
                  const freestyle = /Freestyle/.test(line);
                  return (
                    <li key={i} className={`flex gap-4 px-4 ${failed ? "bg-red-500/[0.06]" : "hover:bg-white/[0.02]"}`}>
                      <span className="w-5 shrink-0 select-none text-right text-zinc-700">{i + 1}</span>
                      <span className={`min-w-0 break-words ${failed ? "text-red-400" : freestyle ? "text-violet-300" : line.startsWith("PR opened") ? "text-emerald-400" : "text-zinc-300"}`}>
                        {line}
                      </span>
                    </li>
                  );
                })}
                {status === "running" && (
                  <li className="flex gap-4 px-4">
                    <span className="w-5 shrink-0" />
                    <span className="animate-pulse text-zinc-600">▍</span>
                  </li>
                )}
              </ol>
            </div>
          )}

          {status === "done" && prUrl && (
            <div className="rounded-xl border border-white/[0.08] bg-[#0a0a0a] p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-base font-medium text-white hover:underline">
                    Pull request #{prUrl.split("/").pop()} opened ↗
                  </a>
                </div>
                {verification && (
                  <span
                    title={VERIFICATION_BADGE[verification].title}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-zinc-300"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${verification === "unverified" ? "bg-amber-400" : "bg-emerald-400"}`} />
                    {VERIFICATION_BADGE[verification].text}
                  </span>
                )}
              </div>
              {job && (
                <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.08] text-sm">
                  <div className="bg-black px-4 py-3">
                    <dt className="text-xs text-zinc-500">Type check</dt>
                    <dd className="mt-1 font-mono text-zinc-200">{tsc ? `${tsc.before} → ${tsc.after}` : "skipped"}</dd>
                  </div>
                  <div className="bg-black px-4 py-3">
                    <dt className="text-xs text-zinc-500">Ran in</dt>
                    <dd className="mt-1 font-mono text-zinc-200">{ranInFreestyle ? "Freestyle VM" : "local"}</dd>
                  </div>
                  <div className="bg-black px-4 py-3">
                    <dt className="text-xs text-zinc-500">Attempts</dt>
                    <dd className="mt-1 font-mono text-zinc-200">{job.attempts}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
