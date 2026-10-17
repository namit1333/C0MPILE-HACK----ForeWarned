"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBox, Spinner } from "./ui";

const DEMO_REPOS = ["A5bhinav/openai-api-example"];

export default function Home() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState("");
  const [scanning, setScanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan(url: string) {
    if (!url.trim() || scanning) return;
    setScanning(url);
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: url.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Scan failed (${res.status})`);
      router.push(`/repo/${body.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setScanning(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl pt-6 sm:pt-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400/90">Self-maintaining APIs</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
        Know what&apos;s about to break, before it does.
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-zinc-400">
        Dependabot tells you a new version exists. Forewarned tells you what&apos;s about to break, and what you&apos;re
        missing, before it happens.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-zinc-500">
        Providers change their APIs constantly: breaking SDK releases, models shut down on a date, features nobody hears
        about. Connect a repo to see every external API it depends on, what&apos;s coming, and get fix PRs labelled with
        exactly what was verified.
      </p>

      <form
        className="mt-10 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          scan(repoUrl);
        }}
      >
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          spellCheck={false}
          autoFocus
          className="h-12 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400/70 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
        />
        <button
          type="submit"
          disabled={!repoUrl.trim() || !!scanning}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-amber-400 px-6 text-sm font-semibold text-zinc-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanning ? <><Spinner /> Scanning…</> : "Scan repo"}
        </button>
      </form>

      {scanning && (
        <p className="mt-3 font-mono text-xs text-zinc-500">Cloning {scanning} and mapping every API call…</p>
      )}
      {error && <div className="mt-4"><ErrorBox>{error}</ErrorBox></div>}

      <div className="mt-8 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">Try a demo repo:</span>
        {DEMO_REPOS.map((r) => (
          <button
            key={r}
            onClick={() => {
              setRepoUrl(`https://github.com/${r}`);
              scan(r);
            }}
            disabled={!!scanning}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50"
          >
            {r}
          </button>
        ))}
      </div>

      <div className="mt-16 grid gap-4 sm:grid-cols-3">
        {[
          ["API inventory", "Every external SDK and API the repo uses, with every call site."],
          ["What's coming", "Breaking releases, model shutdowns with dates, and new features that apply."],
          ["Checked fix PRs", "Patched, type-checked in an isolated sandbox, and labelled honestly."],
        ].map(([title, text]) => (
          <div key={title} className="rounded-xl border border-zinc-800/80 p-4">
            <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
