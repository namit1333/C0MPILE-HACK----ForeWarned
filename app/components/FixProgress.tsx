"use client";

import { verificationLabel, type Job } from "@/app/lib/api";

type Props = {
  job: Job | null;
  title?: string;
  error?: string | null;
};

export function FixProgress({ job, title, error }: Props) {
  if (!job && !error) return null;

  return (
    <section className="fw-rise border-t border-line pt-12" aria-labelledby="fix-heading" aria-live="polite">
      <div className="mb-6 max-w-2xl">
        <p className="mb-2 font-[family-name:var(--font-display)] text-xs uppercase tracking-[0.18em] text-teal-deep">
          Fix progress
        </p>
        <h2 id="fix-heading" className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-ink sm:text-4xl">
          {title ?? "Opening a fix PR"}
        </h2>
        {job ? (
          <p className="mt-3 text-ink-soft">
            Job <span className="font-[family-name:var(--font-mono)] text-sm">{job.jobId}</span>
            {" · "}
            <span className="capitalize">{job.status}</span>
            {job.branch ? (
              <>
                {" · "}
                <span className="font-[family-name:var(--font-mono)] text-sm">{job.branch}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      {error ? <p className="mb-4 text-fail">{error}</p> : null}

      {job ? (
        <div className="border border-line bg-ink px-4 py-4 text-paper sm:px-5">
          <ol className="max-h-72 space-y-1.5 overflow-y-auto font-[family-name:var(--font-mono)] text-[13px] leading-relaxed">
            {job.log.length === 0 ? (
              <li className="text-paper/60">Waiting for first log line…</li>
            ) : (
              job.log.map((line, i) => (
                <li key={`${i}-${line}`} className="fw-log-line text-paper/90">
                  <span className="mr-2 text-signal-soft/80">{String(i + 1).padStart(2, "0")}</span>
                  {line}
                </li>
              ))
            )}
          </ol>
        </div>
      ) : null}

      {job && job.status !== "running" ? (
        <div className="mt-6 space-y-3">
          {job.prUrl ? (
            <p className="text-ink">
              Pull request:{" "}
              <a
                href={job.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-[family-name:var(--font-mono)] text-sm text-teal-deep underline decoration-teal/40 underline-offset-4 hover:text-teal"
              >
                {job.prUrl}
              </a>
            </p>
          ) : job.status === "done" ? (
            <p className="text-ink-soft">Finished without a PR URL (dry run or no push).</p>
          ) : (
            <p className="text-fail">Fix failed — see the log above.</p>
          )}
          <p className="text-sm text-ink-soft">
            Verification:{" "}
            <span className="font-[family-name:var(--font-mono)] text-ink">{verificationLabel(job.verification)}</span>
          </p>
          {job.filesChanged.length > 0 ? (
            <p className="font-[family-name:var(--font-mono)] text-xs text-ink-soft">
              Files: {job.filesChanged.join(", ")}
            </p>
          ) : null}
          {job.checks.length > 0 ? (
            <ul className="space-y-1 text-sm text-ink-soft">
              {job.checks.map((c) => (
                <li key={c.name}>
                  <span className="font-[family-name:var(--font-mono)]">{c.name}</span>: before {c.before} → after {c.after}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
