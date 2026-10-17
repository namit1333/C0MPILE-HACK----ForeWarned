"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const DEMO_REPOS = [
  {
    label: "A5bhinav/openai-api-example",
    url: "https://github.com/A5bhinav/openai-api-example",
  },
];

export default function ConnectPage() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("https://github.com/A5bhinav/openai-api-example");
  const [stage, setStage] = useState<"idle" | "cloning" | "scanning" | "matching">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStage("cloning");

    const t1 = setTimeout(() => setStage("scanning"), 600);
    const t2 = setTimeout(() => setStage("matching"), 1200);

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
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

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-20">
      <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 font-mono text-xs text-teal-400">
        YC RFS · SELF-MAINTAINING APIS
      </div>

      <h1 className="mb-4 text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
        Forewarned
      </h1>
      <p className="mb-10 max-w-2xl text-xl leading-relaxed text-zinc-400">
        Dependabot tells you a new version exists. We tell you what&apos;s about to break, and what
        you&apos;re missing, before it happens.
      </p>

      <form
        onSubmit={handleScan}
        className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            disabled={stage !== "idle"}
            className="h-12 flex-1 rounded-lg border border-zinc-700 bg-black px-4 font-mono text-base text-zinc-100 focus:border-teal-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={stage !== "idle"}
            className="h-12 rounded-lg bg-teal-500 px-7 font-semibold text-zinc-950 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {stage === "idle" ? "Scan" : "Scanning..."}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
          <span>Demo repos:</span>
          {DEMO_REPOS.map((r) => (
            <button
              key={r.url}
              type="button"
              onClick={() => setRepoUrl(r.url)}
              className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono text-xs text-teal-400 hover:border-teal-500/50"
            >
              {r.label}
            </button>
          ))}
          <Link
            href="/repo/A5bhinav__openai-api-example"
            className="ml-auto font-mono text-xs text-teal-400 underline hover:text-teal-300"
          >
            Open pre-scanned dashboard →
          </Link>
        </div>

        {error && <p className="mt-4 font-mono text-sm text-rose-400">{error}</p>}

        {stage !== "idle" && (
          <div className="mt-6 flex items-center gap-4 border-t border-zinc-800 pt-5 font-mono text-sm">
            <span className={stage === "cloning" ? "text-teal-400 font-bold" : "text-emerald-400"}>
              {stage === "cloning" ? "◌ Cloning..." : "✓ Cloned"}
            </span>
            <span className="text-zinc-600">→</span>
            <span
              className={
                stage === "scanning"
                  ? "text-teal-400 font-bold"
                  : stage === "matching"
                    ? "text-emerald-400"
                    : "text-zinc-500"
              }
            >
              {stage === "scanning" ? "◌ Scanning..." : stage === "matching" ? "✓ Scanned" : "Scanning..."}
            </span>
            <span className="text-zinc-600">→</span>
            <span className={stage === "matching" ? "text-teal-400 font-bold" : "text-zinc-500"}>
              {stage === "matching" ? "◌ Matching..." : "Matching..."}
            </span>
          </div>
        )}
      </form>
    </main>
  );
}
