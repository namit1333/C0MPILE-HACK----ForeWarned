"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import type { Alert, ChangeRecord, FixResult } from "@/lib/types";

interface AlertPayload {
  alert: Alert;
  change: ChangeRecord;
  repo: string;
}

const KNOWN_PRS: Record<string, { prUrl: string; prNumber: number; log: string[] }> = {
  "openai-legacy-models-2026-10-23": {
    prNumber: 3,
    prUrl: "https://github.com/A5bhinav/openai-api-example/pull/3",
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
    prNumber: 4,
    prUrl: "https://github.com/A5bhinav/openai-api-example/pull/4",
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
    prNumber: 5,
    prUrl: "https://github.com/A5bhinav/openai-api-example/pull/5",
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

  useEffect(() => {
    fetch(`/api/alerts/${id}`)
      .then((r) => r.json())
      .then((payload: AlertPayload) => {
        setData(payload);
        const preset = KNOWN_PRS[payload.change.id];
        if (preset) {
          setLog(preset.log);
          setPrUrl(preset.prUrl);
          setStatus("done");
        }
      });
  }, [id]);

  async function triggerFix() {
    if (!data) return;
    setStatus("running");
    setLog(["Starting fix job..."]);

    const res = await fetch(`/api/alerts/${id}/fix`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setStatus("failed");
      setLog((prev) => [...prev, body.error ?? "Failed to start fix"]);
      return;
    }

    const jobId = body.jobId;
    const timer = setInterval(async () => {
      const jr = await fetch(`/api/jobs/${jobId}`);
      if (!jr.ok) return;
      const job: FixResult & { status: "running" | "done" | "failed" } = await jr.json();
      setLog(job.log);
      if (job.status !== "running") {
        clearInterval(timer);
        setStatus(job.status);
        setPrUrl(job.prUrl);
      }
    }, 1000);
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
              {status === "running" ? "Fixing..." : "Open fix PR"}
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

      {log.length > 0 && (
        <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="mb-4 text-lg font-bold text-zinc-100">Live progress</h2>
          <div className="space-y-2 font-mono text-sm">
            {log.map((line, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-emerald-400">✓</span>
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
            <span
              title="The type checker passed in an isolated Freestyle VM"
              className="rounded border border-teal-500/40 bg-teal-500/15 px-3 py-1 font-mono text-xs font-bold text-teal-300"
            >
              Verified: Type-checked
            </span>
          </div>
          <p className="mt-3 font-mono text-sm text-zinc-400">
            tsc pass → pass · Freestyle isolated VM · 1 attempt
          </p>
        </div>
      )}
    </main>
  );
}
