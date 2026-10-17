"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import type { Alert, CallSite, ChangeRecord, Inventory } from "@/lib/types";

interface RepoState {
  id: string;
  repoUrl: string;
  inventory: Inventory;
  alerts: Alert[];
  changes: ChangeRecord[];
  notes?: string[];
  openPRs?: Record<string, { number: number; url: string }>; // our open PRs, looked up live on GitHub at scan time
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI", supabase: "Supabase", stripe: "Stripe", anthropic: "Anthropic", resend: "Resend", twilio: "Twilio",
};

const TYPE_STYLE: Record<Alert["type"], { label: string; dot: string }> = {
  deprecation: { label: "Shutdown", dot: "bg-amber-400" },
  breaking: { label: "Breaking", dot: "bg-red-500" },
  feature: { label: "New feature", dot: "bg-sky-400" },
};

const KIND_LABEL: Record<CallSite["kind"], string> = {
  "sdk-call": "call",
  import: "import",
  "model-string": "model",
  "http-endpoint": "endpoint",
};

function formatDeadline(dateStr?: string): string | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const label = target.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const rel = days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : `${-days} days ago`;
  return `${rel} · ${label}`;
}

export default function RepoDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<RepoState | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
      <main className="mx-auto w-full max-w-6xl px-6 py-16">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-zinc-400 hover:text-white">
          ← Back
        </Link>
      </main>
    );
  }

  if (!state) {
    return <main className="mx-auto w-full max-w-6xl px-6 py-16 text-sm text-zinc-500">Loading scan results…</main>;
  }

  const totalApis = state.inventory.dependencies.length;
  const totalCallSites = state.inventory.dependencies.reduce(
    (sum, d) => sum + d.callSites.filter((c) => c.kind !== "import").length,
    0,
  );
  const changeMap = new Map(state.changes.map((c) => [c.id, c]));

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/[0.08] pb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Link href="/" className="hover:text-white">
              Repos
            </Link>
            <span className="text-zinc-700">/</span>
            <a href={state.repoUrl} target="_blank" rel="noopener noreferrer" className="truncate font-mono text-zinc-300 hover:text-white">
              {state.inventory.repo}
            </a>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
            Depends on {totalApis} API{totalApis === 1 ? "" : "s"}
            <span className="text-zinc-600"> · </span>
            {totalCallSites} call site{totalCallSites === 1 ? "" : "s"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Scanned {new Date(state.inventory.scannedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-md border border-white/[0.12] bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-white/[0.06]"
          >
            Rescan
          </Link>
        </div>
      </div>

      {state.notes && state.notes.length > 0 && (
        <div className="mt-6 space-y-1 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-4 py-3 text-sm text-amber-200/90">
          {state.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* What's coming */}
        <section className="min-w-0 lg:col-span-7">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">What&apos;s coming</h2>
          <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            {state.alerts.length === 0 && (
              <p className="px-5 py-6 text-sm text-zinc-500">No known provider changes affect this repo right now.</p>
            )}
            {state.alerts.map((alert) => {
              const change = changeMap.get(alert.changeId);
              const pr = state.openPRs?.[alert.id];
              const t = TYPE_STYLE[alert.type];
              const due = formatDeadline(alert.deadline);
              return (
                <Link
                  key={alert.id}
                  href={`/alert/${alert.id}`}
                  className="group block border-b border-white/[0.08] bg-[#0a0a0a] px-5 py-5 transition-colors last:border-b-0 hover:bg-[#111]"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-zinc-300">
                      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                      {t.label}
                    </span>
                    {due && <span className="font-mono text-xs text-amber-300/90">{due}</span>}
                    {pr && (
                      <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-xs text-zinc-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        PR #{pr.number}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 text-base font-medium text-white">{change?.title ?? alert.changeId}</h3>
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-500">{change?.summary}</p>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-zinc-600">
                      {alert.callSites.length} call site{alert.callSites.length === 1 ? "" : "s"}
                    </span>
                    <span className="text-zinc-400 transition-colors group-hover:text-white">
                      {alert.type === "feature" ? "Open opportunity PR" : "Open fix PR"} →
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Inventory */}
        <section className="min-w-0 lg:col-span-5">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">API inventory</h2>
          <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            {state.inventory.dependencies.length === 0 && (
              <p className="px-5 py-6 text-sm text-zinc-500">No known API SDKs or endpoints found.</p>
            )}
            {state.inventory.dependencies.map((dep) => {
              const key = `${dep.provider}|${dep.package ?? ""}`;
              const isOpen = expanded[key] ?? true;
              const calls = dep.callSites.filter((c) => c.kind !== "import").length;
              return (
                <div key={key} className="border-b border-white/[0.08] bg-[#0a0a0a] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpanded((p) => ({ ...p, [key]: !isOpen }))}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#111]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="text-sm font-medium text-white">{PROVIDER_NAMES[dep.provider] ?? dep.provider}</span>
                      {dep.package && (
                        <span className="truncate font-mono text-xs text-zinc-500">
                          {dep.package}@{dep.version}
                        </span>
                      )}
                    </div>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                      {calls} site{calls === 1 ? "" : "s"}
                      <span className={`transition-transform ${isOpen ? "rotate-180" : ""}`}>⌄</span>
                    </span>
                  </button>

                  {isOpen && (
                    <ul className="border-t border-white/[0.08] bg-black">
                      {dep.callSites.map((site, idx) => (
                        <li key={`${site.file}:${site.line}:${idx}`} className="border-b border-white/[0.05] px-5 py-3 last:border-b-0">
                          <div className="flex items-center gap-2 font-mono text-xs">
                            <span className="shrink-0 rounded border border-white/10 px-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
                              {KIND_LABEL[site.kind]}
                            </span>
                            <span className="truncate text-zinc-400">
                              {site.file}
                              <span className="text-zinc-600">:{site.line}</span>
                            </span>
                          </div>
                          <code className="mt-1.5 block overflow-x-auto whitespace-pre font-mono text-xs text-zinc-200">{site.snippet}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
