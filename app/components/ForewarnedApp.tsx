"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  DEMO_REPO_URL,
  getJob,
  loadOfflineDemo,
  scanRepo,
  startFix,
  changeForAlert,
  type Job,
  type RepoState,
} from "@/app/lib/api";
import type { Alert } from "@/lib/types";
import { AlertsSection } from "./AlertsSection";
import { FixProgress } from "./FixProgress";
import { InventorySection } from "./InventorySection";
import { RepoForm } from "./RepoForm";

const LIVE_DEMO =
  Boolean(process.env.NEXT_PUBLIC_DEMO_REPO?.trim()) &&
  !DEMO_REPO_URL.includes("github.com/demo/");

export function ForewarnedApp() {
  const [repoUrl, setRepoUrl] = useState(LIVE_DEMO ? DEMO_REPO_URL : "");
  const [state, setState] = useState<RepoState | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [jobTitle, setJobTitle] = useState<string | undefined>();
  const [fixError, setFixError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [, startTransition] = useTransition();
  const resultsRef = useRef<HTMLDivElement>(null);
  const fixRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await getJob(job.jobId);
        if (!cancelled) setJob(next);
      } catch {
        /* keep last snapshot; next poll may recover */
      }
    };
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [job]);

  useEffect(() => {
    if (!job || job.status === "running") return;
    const alertId = job.alertId;
    const nextStatus: Alert["status"] = job.prUrl ? "pr-opened" : job.status === "failed" ? "failed" : "open";
    startTransition(() => {
      setState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          alerts: prev.alerts.map((a) => (a.id === alertId ? { ...a, status: nextStatus } : a)),
        };
      });
      setFixingId(null);
    });
  }, [job]);

  async function runScan(url: string) {
    setScanning(true);
    setScanError(null);
    setFixError(null);
    setJob(null);
    setJobTitle(undefined);
    setFixingId(null);
    setDemoMode(false);
    try {
      const next = await scanRepo(url.trim());
      setState(next);
      setRepoUrl(url.trim());
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setState(null);
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function runOffline() {
    setScanning(true);
    setScanError(null);
    setFixError(null);
    setJob(null);
    setJobTitle(undefined);
    setFixingId(null);
    try {
      const next = await loadOfflineDemo();
      setState(next);
      setDemoMode(true);
      setRepoUrl(next.repoUrl);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setState(null);
      setScanError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  async function openFix(alert: Alert) {
    if (!state) return;
    setFixingId(alert.id);
    setFixError(null);
    setJob(null);
    const change = changeForAlert(state, alert);
    setJobTitle(change?.title ?? alert.changeId);
    try {
      const jobId = await startFix(alert.id, { demo: demoMode, dryRun: !demoMode && dryRun });
      setJob({
        jobId,
        status: "running",
        alertId: alert.id,
        branch: `forewarned/${alert.changeId}`,
        filesChanged: [],
        checks: [],
        verification: "unverified",
        attempts: 0,
        log: [],
      });
      setState({
        ...state,
        alerts: state.alerts.map((a) => (a.id === alert.id ? { ...a, status: "fixing" } : a)),
      });
      requestAnimationFrame(() => fixRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      setFixingId(null);
      setFixError(e instanceof Error ? e.message : String(e));
      requestAnimationFrame(() => fixRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  return (
    <div className="fw-atmosphere flex min-h-full flex-1 flex-col">
      <header className="mx-auto w-full max-w-5xl px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20">
        <div className="fw-rise mb-8 flex items-center gap-3">
          <span className="fw-signal-dot inline-block h-2.5 w-2.5 bg-signal" aria-hidden />
          <span className="font-[family-name:var(--font-display)] text-xs uppercase tracking-[0.22em] text-ink-soft">
            Self-maintaining APIs
          </span>
        </div>

        <h1 className="fw-rise fw-rise-delay-1 font-[family-name:var(--font-display)] text-[clamp(3.25rem,12vw,6.5rem)] leading-[0.92] tracking-[-0.03em] text-ink">
          Forewarned
        </h1>
        <div className="fw-brand-rule mt-5 h-[3px] w-24 bg-signal sm:w-32" aria-hidden />

        <p className="fw-rise fw-rise-delay-2 mt-8 max-w-xl text-lg leading-relaxed text-ink-soft sm:text-xl">
          Dependabot tells you a new version exists. We tell you what&apos;s about to break — and open the fix PR.
        </p>

        <div className="mt-10">
          <RepoForm
            repoUrl={repoUrl}
            scanning={scanning}
            onRepoUrlChange={setRepoUrl}
            onCheckNow={() => void runScan(repoUrl)}
            onUseDemoSample={() => void runScan(DEMO_REPO_URL)}
            onOfflineWalkthrough={() => void runOffline()}
            hasLiveDemoRepo={LIVE_DEMO}
          />
        </div>

        {scanError ? (
          <p className="fw-rise mt-5 max-w-xl text-sm text-fail" role="alert">
            {scanError}
          </p>
        ) : null}
        {demoMode && state ? (
          <p className="fw-rise mt-5 max-w-xl text-sm text-teal-deep">
            Offline sample loaded — inventory and alerts are real shapes; fix jobs are simulated and polled through{" "}
            <code className="font-[family-name:var(--font-mono)] text-xs">/api/jobs</code>.
          </p>
        ) : null}
      </header>

      {state ? (
        <main ref={resultsRef} className="mx-auto w-full max-w-5xl flex-1 px-5 pb-20 sm:px-8">
          <InventorySection inventory={state.inventory} />
          <div className="mt-14">
            {!demoMode ? (
              <label className="mb-6 flex max-w-xl cursor-pointer items-start gap-3 text-sm text-ink-soft">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="mt-1 accent-teal"
                />
                <span>
                  Dry run fixes (patch + checks, no push or PR). Use this to rehearse without touching GitHub.
                </span>
              </label>
            ) : null}
            <AlertsSection
              state={state}
              fixingId={fixingId}
              activeJobAlertId={job?.alertId ?? null}
              onOpenFix={(a) => void openFix(a)}
            />
          </div>
          <div ref={fixRef} className="mt-14">
            <FixProgress job={job} title={jobTitle} error={fixError} />
          </div>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-16 sm:px-8">
          <section className="border-t border-line pt-10">
            <h2 className="font-[family-name:var(--font-display)] text-2xl text-ink">How a check works</h2>
            <ol className="mt-5 max-w-xl space-y-3 text-ink-soft">
              <li>1. Clone the repo and inventory every external SDK and API call site.</li>
              <li>2. Match that inventory against provider change records — breakages, shutdowns, opportunities.</li>
              <li>3. Open a fix PR on your fork, run checks, and label only what actually passed.</li>
            </ol>
          </section>
        </main>
      )}

      <footer className="mx-auto w-full max-w-5xl px-5 pb-10 pt-4 text-xs text-ink-soft/70 sm:px-8">
        PRs open only on forks we own. Verification labels: tests-exercise-call · type-checked · unverified.
      </footer>
    </div>
  );
}
