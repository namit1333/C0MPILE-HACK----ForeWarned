"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import type { Alert, ChangeRecord, Inventory } from "@/lib/types";

interface RepoState {
  id: string;
  repoUrl: string;
  inventory: Inventory;
  alerts: Alert[];
  changes: ChangeRecord[];
  notes?: string[];
}

const PR_URLS: Record<string, { number: number; url: string }> = {
  "openai-legacy-models-2026-10-23": {
    number: 3,
    url: "https://github.com/A5bhinav/openai-api-example/pull/3",
  },
  "openai-node-v4": {
    number: 4,
    url: "https://github.com/A5bhinav/openai-api-example/pull/4",
  },
  "openai-responses-api": {
    number: 5,
    url: "https://github.com/A5bhinav/openai-api-example/pull/5",
  },
};

function formatDeadline(dateStr?: string): string | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const now = new Date("2026-10-17T00:00:00");
  const days = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const label = target.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${label} · in ${days} days`;
}

export default function RepoDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<RepoState | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ openai: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/repos/${id}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load repo");
        setState(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="font-mono text-rose-400">{error}</p>
        <Link href="/" className="mt-4 inline-block font-mono text-sm text-teal-400 underline">
          ← Back to Connect
        </Link>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 font-mono text-zinc-400">
        Loading scan results...
      </main>
    );
  }

  const totalApis = state.inventory.dependencies.length;
  const totalCallSites = state.inventory.dependencies.reduce(
    (sum, d) => sum + d.callSites.filter((c) => c.kind !== "import").length,
    0,
  );
  const changeMap = new Map(state.changes.map((c) => [c.id, c]));

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <div>
          <div className="mb-1 flex items-center gap-3 font-mono text-sm text-zinc-400">
            <Link href="/" className="hover:text-teal-400">
              Forewarned
            </Link>
            <span>/</span>
            <a
              href={state.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-400 hover:underline"
            >
              {state.inventory.repo} ↗
            </a>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
            Depends on <span className="text-teal-400">{totalApis} API</span> ·{" "}
            <span className="text-teal-400">{totalCallSites} call sites</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-400">
            Scanned {new Date(state.inventory.scannedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-100 hover:bg-zinc-800"
          >
            Rescan
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Inventory Column */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950 lg:col-span-5">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-lg font-bold text-zinc-100">API inventory</h2>
          </div>
          <div>
            {state.inventory.dependencies.map((dep) => {
              const key = dep.provider;
              const isOpen = expanded[key] ?? true;
              return (
                <div key={key} className="border-b border-zinc-800 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpanded((p) => ({ ...p, [key]: !isOpen }))}
                    className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-zinc-900/60"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold capitalize text-zinc-100">
                        {dep.provider}
                      </span>
                      {dep.package && (
                        <span className="rounded border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 font-mono text-xs text-teal-300">
                          {dep.package}@{dep.version}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-sm text-zinc-400">
                      {dep.callSites.length} ▾
                    </span>
                  </button>

                  {isOpen && (
                    <div className="space-y-2 border-t border-zinc-800 bg-black/60 p-4">
                      {dep.callSites.map((site, idx) => (
                        <div
                          key={`${site.file}:${site.line}:${idx}`}
                          className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs"
                        >
                          <div className="mb-1 flex items-center justify-between text-teal-400">
                            <span>
                              {site.file}:{site.line}
                            </span>
                            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
                              {site.symbol}
                            </span>
                          </div>
                          <div className="overflow-x-auto whitespace-pre text-zinc-400">
                            {site.snippet}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Timeline Column */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950 lg:col-span-7">
          <div className="border-b border-zinc-800 px-5 py-4">
            <h2 className="text-lg font-bold text-zinc-100">What&apos;s coming</h2>
          </div>
          <div>
            {state.alerts.map((alert) => {
              const change = changeMap.get(alert.changeId);
              const pr = PR_URLS[alert.changeId];
              const badgeColor =
                alert.type === "breaking"
                  ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                  : alert.type === "deprecation"
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                    : "border-sky-500/40 bg-sky-500/15 text-sky-300";

              return (
                <Link
                  key={alert.id}
                  href={`/alert/${alert.id}`}
                  className="block border-b border-zinc-800 px-5 py-5 transition-colors hover:bg-zinc-900/60 last:border-b-0"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded border px-2.5 py-0.5 font-mono text-xs font-bold uppercase ${badgeColor}`}
                      >
                        {alert.type}
                      </span>
                      {alert.deadline && (
                        <span className="font-mono text-xs font-semibold text-amber-300">
                          {formatDeadline(alert.deadline)}
                        </span>
                      )}
                    </div>
                    {pr && (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-0.5 font-mono text-xs text-emerald-300">
                        ✓ PR #{pr.number} opened
                      </span>
                    )}
                  </div>
                  <h3 className="text-xl font-bold text-zinc-100">
                    {change?.title ?? alert.changeId}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">{change?.summary}</p>
                  <div className="mt-3 flex items-center justify-between font-mono text-xs text-zinc-500">
                    <span>
                      {alert.callSites.length} call site
                      {alert.callSites.length === 1 ? "" : "s"}
                    </span>
                    <span className="text-teal-400">Open migration &amp; PR →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
