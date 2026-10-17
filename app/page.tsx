"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STAGES = [
  { key: "cloning", label: "Clone" },
  { key: "scanning", label: "Scan" },
  { key: "matching", label: "Match" },
] as const;

export default function ConnectPage() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [stage, setStage] = useState<"idle" | "cloning" | "scanning" | "matching">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    setError(null);
    setStage("cloning");

    const t1 = setTimeout(() => setStage("scanning"), 600);
    const t2 = setTimeout(() => setStage("matching"), 1200);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });
      const data = await res.json();
      clearTimeout(t1);
      clearTimeout(t2);
      if (!res.ok) {
        setStage("idle");
        setError(data.error ?? "Scan failed");
        return;
      }
      router.push(`/repo/${data.id}`);
    } catch (err) {
      clearTimeout(t1);
      clearTimeout(t2);
      setStage("idle");
      setError(err instanceof Error ? err.message : "Network error");
    }
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <main className="relative flex flex-1 flex-col">
      <div className="hero-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-24">
        <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          YC RFS · Self-maintaining APIs
        </div>

        <h1 className="text-5xl font-semibold tracking-[-0.04em] text-white sm:text-6xl">
          Know what breaks
          <br />
          <span className="text-zinc-500">before it does.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
          Dependabot tells you a new version exists. Forewarned tells you what&apos;s about to break, and what
          you&apos;re missing, before it happens.
        </p>

        <form onSubmit={handleScan} className="mt-10">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0a0a0a] p-1.5 transition-colors focus-within:border-white/25">
            <input
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              disabled={stage !== "idle"}
              spellCheck={false}
              className="h-10 min-w-0 flex-1 bg-transparent pl-3 font-mono text-sm text-white placeholder:text-zinc-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={stage !== "idle" || !repoUrl.trim()}
              className="h-10 rounded-lg bg-white px-5 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {stage === "idle" ? "Scan" : "Scanning…"}
            </button>
          </div>

          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

          {stage !== "idle" && (
            <div className="mt-4 flex items-center gap-3 font-mono text-xs">
              {STAGES.map((s, i) => (
                <div key={s.key} className="flex items-center gap-3">
                  <span className={`flex items-center gap-1.5 ${i < stageIndex ? "text-zinc-400" : i === stageIndex ? "text-white" : "text-zinc-600"}`}>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${i < stageIndex ? "bg-emerald-400" : i === stageIndex ? "animate-pulse bg-amber-400" : "bg-zinc-700"}`}
                    />
                    {s.label}
                  </span>
                  {i < STAGES.length - 1 && <span className="text-zinc-700">—</span>}
                </div>
              ))}
            </div>
          )}
        </form>

        <div className="mt-20 grid gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.08] sm:grid-cols-3">
          {[
            ["API inventory", "Every external SDK and API the repo calls, with every call site."],
            ["What's coming", "Breaking releases, model shutdowns with dates, and features you're missing."],
            ["Checked fix PRs", "Patched, type-checked in an isolated sandbox, labelled with what was verified."],
          ].map(([title, text]) => (
            <div key={title} className="bg-black p-5">
              <h3 className="text-sm font-medium text-white">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
