"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/pipeline";
import type { Alert, ChangeRecord, CheckResult } from "@/lib/types";
import { Card, ErrorBox, Spinner, TypeBadge, VERIFICATION_TEXT, VerificationBadge, cx, deadlineText } from "../../ui";

interface AlertData {
  alert: Alert;
  change: ChangeRecord;
  repo: { id: string; repoUrl: string; slug: string };
}

export default function AlertView() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const jobId = search.get("job");
  const dryRun = search.get("dryRun") === "1";

  const [data, setData] = useState<AlertData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const feedEnd = useRef<HTMLLIElement>(null);

  useEffect(() => {
    fetch(`/api/alerts/${id}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Failed to load (${res.status})`);
        setData(body);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  // Poll the job every second until it finishes.
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) return;
        const next: Job = await res.json();
        if (stopped) return;
        setJob(next);
        if (next.status !== "running") {
          stopped = true;
          clearInterval(timer);
        }
      } catch {
        // transient; the next tick retries
      }
    };
    const timer = setInterval(tick, 1000);
    tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId]);

  useEffect(() => {
    if (job?.status !== "running" || startedAt === null) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(t);
  }, [job?.status, startedAt]);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [job?.log.length]);

  async function openFix() {
    setStarting(true);
    setError(null);
    setJob(null);
    try {
      const res = await fetch(`/api/alerts/${id}/fix${dryRun ? "?dryRun=1" : ""}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Could not start the fix (${res.status})`);
      setStartedAt(Date.now());
      setElapsed(0);
      router.replace(`/alert/${id}?job=${body.jobId}${dryRun ? "&dryRun=1" : ""}`, { scroll: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  if (error && !data) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <p className="flex items-center gap-2 text-sm text-zinc-500"><Spinner /> Loading…</p>;

  const { alert, change, repo } = data;
  const due = deadlineText(change.effectiveDate);
  const running = starting || job?.status === "running";
  const isFeature = change.type === "feature";

  return (
    <div className="space-y-8">
      <Link href={`/repo/${repo.id}`} className="inline-block break-all font-mono text-sm text-zinc-500 hover:text-zinc-300">← {repo.slug}</Link>

      <div className="grid gap-8 lg:grid-cols-5">
        <section className="min-w-0 space-y-5 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={change.type} />
            {due && <span className={cx("font-mono text-xs", change.type === "deprecation" ? "text-amber-300" : "text-zinc-400")}>{due}</span>}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{change.title}</h1>
          <p className="leading-relaxed text-zinc-300">{change.summary}</p>
          <a href={change.sourceUrl} target="_blank" rel="noreferrer" className="inline-block break-all font-mono text-xs text-amber-300/90 hover:text-amber-200">
            Source: {change.sourceUrl} ↗
          </a>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Affected call sites ({alert.callSites.length})
            </h2>
            <ul className="space-y-2">
              {alert.callSites.map((c) => (
                <li key={`${c.file}:${c.line}:${c.symbol}`} className="rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                  <p className="font-mono text-xs text-zinc-500">{c.file}:{c.line}</p>
                  <code className="mt-1 block overflow-x-auto whitespace-pre font-mono text-xs text-zinc-200">{c.snippet}</code>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="min-w-0 space-y-4 lg:col-span-3">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-zinc-100">{isFeature ? "Opportunity PR" : "Fix PR"}</h2>
                <p className="mt-0.5 text-sm text-zinc-500">
                  Patch the call sites, type-check in an isolated sandbox, retry on errors, open a PR on {repo.slug}.
                </p>
              </div>
              <button
                onClick={openFix}
                disabled={running}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-amber-400 px-5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {running ? <><Spinner /> Working…</> : job ? "Run again" : isFeature ? "Open opportunity PR" : "Open fix PR"}
              </button>
            </div>
            {dryRun && <p className="mt-3 font-mono text-xs text-sky-300">Dry run: patches and checks, but won&apos;t push or open a PR.</p>}
            {error && <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>}
          </Card>

          {(job || jobId) && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Live progress</span>
                <span className="font-mono text-xs text-zinc-500">
                  {job?.status === "running" ? <span className="flex items-center gap-2 text-amber-300"><Spinner />{startedAt ? `${elapsed}s` : "running"}</span> : job?.status === "done" ? <span className="text-emerald-300">done</span> : job?.status === "failed" ? <span className="text-red-300">failed</span> : "starting…"}
                </span>
              </div>
              <ol className="max-h-96 space-y-1 overflow-y-auto bg-zinc-950/70 p-4 font-mono text-[13px] leading-relaxed">
                {(job?.log ?? []).map((line, i) => (
                  <li key={i} className={cx("flex gap-2", lineClass(line))}>
                    <span className="select-none text-zinc-600">{String(i + 1).padStart(2, " ")}</span>
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                ))}
                {job?.status === "running" && <li className="text-zinc-600">▍</li>}
                <li ref={feedEnd} />
              </ol>
            </Card>
          )}

          {job && job.status !== "running" && job.checks.length > 0 && (
            <Card className="space-y-5 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <VerificationBadge verification={job.verification} />
                <span className="text-sm text-zinc-400">{VERIFICATION_TEXT[job.verification].detail}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                    <th className="pb-2 font-medium">Check</th>
                    <th className="pb-2 font-medium">Before</th>
                    <th className="pb-2 font-medium">After</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {job.checks.map((c) => (
                    <tr key={c.name} className="border-t border-zinc-800">
                      <td className="py-2 text-zinc-300">{c.name === "tsc" ? "tsc --noEmit" : "npm test"}</td>
                      <td className="py-2"><CheckCell r={c.before} /></td>
                      <td className="py-2"><CheckCell r={c.after} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {job.filesChanged.length > 0 && (
                <p className="text-sm text-zinc-500">
                  {job.filesChanged.length} file{job.filesChanged.length === 1 ? "" : "s"} changed · {job.attempts} attempt{job.attempts === 1 ? "" : "s"} ·{" "}
                  <span className="font-mono text-zinc-400">{job.branch}</span>
                </p>
              )}
              {job.prUrl && (
                <a
                  href={job.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-lg bg-emerald-500/15 px-4 py-3 font-medium text-emerald-200 ring-1 ring-inset ring-emerald-500/30 transition hover:bg-emerald-500/25"
                >
                  <span>View pull request on GitHub</span>
                  <span className="font-mono text-sm">{job.prUrl.replace("https://github.com/", "")} ↗</span>
                </a>
              )}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function lineClass(line: string): string {
  if (line.startsWith("Failed")) return "text-red-300";
  if (line.startsWith("PR opened")) return "text-emerald-300";
  if (/^(Retry|Agent reported|npm reported|npm install reported)/.test(line)) return "text-amber-300";
  if (/Freestyle/.test(line)) return "text-violet-300";
  if (/^(Before|After|Verification):/.test(line)) return "text-zinc-100";
  return "text-zinc-400";
}

function CheckCell({ r }: { r: CheckResult }) {
  if (r === "pass") return <span className="text-emerald-300">✓ pass</span>;
  if (r === "fail") return <span className="text-red-300">✗ fail</span>;
  return <span className="text-zinc-500">– skipped</span>;
}
