"use client";

import { changeForAlert, typeLabel, type RepoState } from "@/app/lib/api";
import type { Alert } from "@/lib/types";

type Props = {
  state: RepoState;
  fixingId: string | null;
  activeJobAlertId: string | null;
  onOpenFix: (alert: Alert) => void;
};

function statusCopy(status: Alert["status"]): string {
  switch (status) {
    case "open":
      return "Open";
    case "fixing":
      return "Fixing…";
    case "pr-opened":
      return "PR opened";
    case "failed":
      return "Failed";
  }
}

export function AlertsSection({ state, fixingId, activeJobAlertId, onOpenFix }: Props) {
  const sorted = [...state.alerts].sort((a, b) => {
    const rank = (t: Alert["type"]) => (t === "breaking" ? 0 : t === "deprecation" ? 1 : 2);
    if (rank(a.type) !== rank(b.type)) return rank(a.type) - rank(b.type);
    return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
  });

  return (
    <section className="fw-rise border-t border-line pt-12" aria-labelledby="alerts-heading">
      <div className="mb-6 max-w-2xl">
        <p className="mb-2 font-[family-name:var(--font-display)] text-xs uppercase tracking-[0.18em] text-signal">
          What&apos;s coming
        </p>
        <h2 id="alerts-heading" className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-ink sm:text-4xl">
          Changes that hit this code
        </h2>
        <p className="mt-3 text-ink-soft">
          {sorted.length === 0
            ? "No matching provider changes right now."
            : `${sorted.length} alert${sorted.length === 1 ? "" : "s"} matched against hand-written change records.`}
        </p>
      </div>

      <div className="fw-stagger space-y-6">
        {sorted.map((alert) => {
          const change = changeForAlert(state, alert);
          const busy = fixingId === alert.id || alert.status === "fixing";
          const isActive = activeJobAlertId === alert.id;
          const isOpportunity = alert.type === "feature";
          const cta = isOpportunity ? "Open opportunity PR" : "Open fix PR";

          return (
            <article
              key={alert.id}
              className={`border border-line bg-surface/80 px-4 py-5 sm:px-6 ${isActive ? "border-l-4 border-l-signal" : ""}`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 max-w-2xl">
                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.14em]">
                    <span
                      className={
                        alert.type === "breaking"
                          ? "text-fail"
                          : alert.type === "deprecation"
                            ? "text-warn"
                            : "text-teal"
                      }
                    >
                      {typeLabel(alert.type)}
                    </span>
                    <span className="text-ink-soft/70">{statusCopy(alert.status)}</span>
                    {alert.deadline ? <span className="text-signal">Deadline {alert.deadline}</span> : null}
                  </div>
                  <h3 className="font-[family-name:var(--font-display)] text-xl text-ink sm:text-2xl">
                    {change?.title ?? alert.changeId}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
                    {change?.summary ?? "Matched change record for this inventory."}
                  </p>
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-xs text-ink-soft">
                    {alert.callSites.length} call site{alert.callSites.length === 1 ? "" : "s"}
                    {change?.sourceUrl ? (
                      <>
                        {" · "}
                        <a
                          href={change.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-ink/20 underline-offset-2 hover:text-ink"
                        >
                          source
                        </a>
                      </>
                    ) : null}
                  </p>
                  <ul className="mt-3 space-y-1">
                    {alert.callSites.slice(0, 4).map((site, i) => (
                      <li key={`${site.file}:${site.line}:${i}`} className="font-[family-name:var(--font-mono)] text-xs text-ink-soft">
                        {site.file}:{site.line} — {site.symbol}
                      </li>
                    ))}
                    {alert.callSites.length > 4 ? (
                      <li className="text-xs text-ink-soft/70">+{alert.callSites.length - 4} more</li>
                    ) : null}
                  </ul>
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    disabled={busy || alert.status === "pr-opened"}
                    onClick={() => onOpenFix(alert)}
                    className="w-full border border-signal bg-signal px-4 py-2.5 font-[family-name:var(--font-display)] text-sm tracking-wide text-paper transition-colors hover:bg-[#a84f24] disabled:cursor-not-allowed disabled:border-mist disabled:bg-mist disabled:text-ink-soft sm:w-auto"
                  >
                    {busy ? "Starting…" : alert.status === "pr-opened" ? "PR opened" : cta}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
