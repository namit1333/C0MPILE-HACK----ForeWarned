"use client";

import { DEMO_REPO_URL } from "@/app/lib/api";

type Props = {
  repoUrl: string;
  scanning: boolean;
  onRepoUrlChange: (value: string) => void;
  onCheckNow: () => void;
  onUseDemoSample: () => void;
  onOfflineWalkthrough: () => void;
  hasLiveDemoRepo: boolean;
};

export function RepoForm({
  repoUrl,
  scanning,
  onRepoUrlChange,
  onCheckNow,
  onUseDemoSample,
  onOfflineWalkthrough,
  hasLiveDemoRepo,
}: Props) {
  return (
    <form
      className="fw-rise fw-rise-delay-3 w-full max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        onCheckNow();
      }}
    >
      <label htmlFor="repo-url" className="mb-2 block font-[family-name:var(--font-display)] text-sm tracking-wide text-ink-soft">
        GitHub repository
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <input
          id="repo-url"
          type="url"
          name="repoUrl"
          value={repoUrl}
          onChange={(e) => onRepoUrlChange(e.target.value)}
          placeholder="https://github.com/owner/name"
          autoComplete="url"
          disabled={scanning}
          className="min-w-0 flex-1 border border-line bg-surface px-4 py-3 text-base text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-soft/50 focus:border-teal disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={scanning || !repoUrl.trim()}
          className="shrink-0 border border-teal-deep bg-teal-deep px-5 py-3 font-[family-name:var(--font-display)] text-sm tracking-wide text-paper transition-colors hover:bg-teal disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanning ? "Checking…" : "Check now"}
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
        {hasLiveDemoRepo ? (
          <button
            type="button"
            disabled={scanning}
            onClick={onUseDemoSample}
            className="text-left text-sm text-teal-deep underline decoration-teal/40 underline-offset-4 transition-colors hover:text-teal hover:decoration-teal disabled:opacity-50"
          >
            Use demo sample
          </button>
        ) : null}
        <button
          type="button"
          disabled={scanning}
          onClick={onOfflineWalkthrough}
          className="text-left text-sm text-ink-soft underline decoration-ink/20 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink/50 disabled:opacity-50"
        >
          Offline walkthrough
        </button>
        {!hasLiveDemoRepo ? (
          <span className="text-xs text-ink-soft/80">
            Live sample not configured — paste a fork URL, or run offline.
          </span>
        ) : (
          <span className="text-xs text-ink-soft/80 truncate max-w-full">{DEMO_REPO_URL.replace(/^https:\/\/github.com\//, "")}</span>
        )}
      </div>
    </form>
  );
}
