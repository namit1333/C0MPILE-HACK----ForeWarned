"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { RepoState } from "@/lib/pipeline";
import type { CallSite, Dependency } from "@/lib/types";
import { Card, ErrorBox, Spinner, StatusText, TypeBadge, cx, deadlineText, providerName } from "../../ui";

const KIND_LABEL: Record<CallSite["kind"], string> = {
  "sdk-call": "call",
  import: "import",
  "model-string": "model id",
  "http-endpoint": "endpoint",
};

type Loaded = { kind: "ok"; state: RepoState } | { kind: "missing" } | { kind: "error"; message: string };

async function fetchRepo(id: string): Promise<Loaded> {
  try {
    const res = await fetch(`/api/repos/${id}`, { cache: "no-store" });
    if (res.status === 404) return { kind: "missing" };
    const body = await res.json();
    return res.ok ? { kind: "ok", state: body } : { kind: "error", message: body.error ?? `Failed to load (${res.status})` };
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

export default function RepoView() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<RepoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [rescanning, setRescanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchRepo(id).then((r) => {
      if (cancelled) return;
      if (r.kind === "ok") setState(r.state);
      else if (r.kind === "missing") setMissing(true);
      else setError(r.message);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function rescan() {
    setRescanning(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: state?.repoUrl ?? id.replace("__", "/") }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Scan failed (${res.status})`);
      setState(body);
      setMissing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRescanning(false);
    }
  }

  const slug = state?.inventory.repo ?? id.replace("__", "/");
  const rescanButton = (
    <button
      onClick={rescan}
      disabled={rescanning}
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
    >
      {rescanning ? <><Spinner /> Checking…</> : "Check now"}
    </button>
  );

  if (missing) {
    return (
      <div className="space-y-4">
        <h1 className="font-mono text-xl text-zinc-100">{slug}</h1>
        <p className="text-zinc-400">This repo hasn&apos;t been scanned yet.</p>
        {rescanButton}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    );
  }
  if (error && !state) return <ErrorBox>{error}</ErrorBox>;
  if (!state) return <p className="flex items-center gap-2 text-sm text-zinc-500"><Spinner /> Loading scan…</p>;

  const deps = state.inventory.dependencies;
  const callSites = deps.reduce((n, d) => n + d.callSites.filter((c) => c.kind !== "import").length, 0);
  const changeById = new Map(state.changes.map((c) => [c.id, c]));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <a href={`https://github.com/${slug}`} target="_blank" rel="noreferrer" className="break-all font-mono text-sm text-zinc-500 hover:text-zinc-300">
            github.com/{slug} ↗
          </a>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
            Depends on {deps.length} API{deps.length === 1 ? "" : "s"}, {callSites} call site{callSites === 1 ? "" : "s"}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">Scanned {new Date(state.inventory.scannedAt).toLocaleString()}</p>
        </div>
        {rescanButton}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}
      {state.notes?.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/90">
          {state.notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-5">
        <section className="min-w-0 lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">What&apos;s coming</h2>
          {state.alerts.length === 0 ? (
            <Card className="p-5 text-sm text-zinc-400">No known provider changes affect this repo right now.</Card>
          ) : (
            <ol className="space-y-3">
              {state.alerts.map((a) => {
                const change = changeById.get(a.changeId);
                const due = deadlineText(a.deadline);
                return (
                  <li key={a.id}>
                    <Link href={`/alert/${a.id}`} className="group block">
                      <Card className="p-4 transition group-hover:border-zinc-600 group-hover:bg-zinc-900">
                        <div className="flex flex-wrap items-center gap-2">
                          <TypeBadge type={a.type} />
                          {due && <span className={cx("font-mono text-xs", a.type === "deprecation" ? "text-amber-300" : "text-zinc-400")}>{due}</span>}
                          <span className="ml-auto"><StatusText status={a.status} /></span>
                        </div>
                        <h3 className="mt-2 font-medium text-zinc-100">{change?.title ?? a.changeId}</h3>
                        {change && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-400">{change.summary}</p>}
                        <p className="mt-2 text-xs text-zinc-500">
                          {a.callSites.length} affected call site{a.callSites.length === 1 ? "" : "s"} · <span className="text-zinc-300 group-hover:text-amber-300">{a.type === "feature" ? "Open opportunity PR →" : "Open fix PR →"}</span>
                        </p>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="min-w-0 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">API inventory</h2>
          {deps.length === 0 ? (
            <Card className="p-5 text-sm text-zinc-400">No known API SDKs or endpoints found.</Card>
          ) : (
            <div className="space-y-3">{deps.map((d) => <DependencyCard key={`${d.provider}|${d.package ?? ""}`} dep={d} />)}</div>
          )}
        </section>
      </div>
    </div>
  );
}

function DependencyCard({ dep }: { dep: Dependency }) {
  const calls = dep.callSites.filter((c) => c.kind !== "import").length;
  return (
    <Card>
      <details>
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-100">{providerName(dep.provider)}</p>
            <p className="truncate font-mono text-xs text-zinc-500">{dep.package ? `${dep.package}@${dep.version ?? "?"}` : "raw HTTP / model ids"}</p>
          </div>
          <span className="shrink-0 rounded-md bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300">{calls} site{calls === 1 ? "" : "s"}</span>
        </summary>
        <ul className="max-h-80 space-y-2 overflow-y-auto border-t border-zinc-800 p-3">
          {dep.callSites.map((c) => (
            <li key={`${c.file}:${c.line}:${c.symbol}:${c.kind}`} className="rounded-md bg-zinc-950/60 p-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">{KIND_LABEL[c.kind]}</span>
                <span className="truncate font-mono text-zinc-400">{c.file}:{c.line}</span>
              </div>
              <code className="mt-1.5 block overflow-x-auto whitespace-pre font-mono text-xs text-zinc-200">{c.snippet}</code>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
