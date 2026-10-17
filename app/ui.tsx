// Small presentational pieces shared by the pages.
import type { Alert, ChangeRecord, Verification } from "@/lib/types";

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI", supabase: "Supabase", stripe: "Stripe", anthropic: "Anthropic", resend: "Resend", twilio: "Twilio",
};
export const providerName = (p: string) => PROVIDER_NAMES[p] ?? p;

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const TYPE_STYLE: Record<ChangeRecord["type"], { label: string; className: string }> = {
  breaking: { label: "Breaking", className: "bg-red-500/15 text-red-300 ring-red-500/30" },
  deprecation: { label: "Shutdown", className: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  feature: { label: "New feature", className: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
};

export function TypeBadge({ type }: { type: ChangeRecord["type"] }) {
  const s = TYPE_STYLE[type];
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", s.className)}>{s.label}</span>;
}

const STATUS_STYLE: Record<Alert["status"], { label: string; className: string }> = {
  open: { label: "Open", className: "text-zinc-400" },
  fixing: { label: "Fixing…", className: "text-amber-300" },
  "pr-opened": { label: "PR opened", className: "text-emerald-300" },
  failed: { label: "Fix failed", className: "text-red-300" },
};

export function StatusText({ status }: { status: Alert["status"] }) {
  const s = STATUS_STYLE[status];
  return <span className={cx("text-xs font-medium", s.className)}>{s.label}</span>;
}

export const VERIFICATION_TEXT: Record<Verification, { label: string; className: string; detail: string }> = {
  "tests-exercise-call": {
    label: "Tests exercise the call",
    className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    detail: "A passing test calls the changed SDK code without mocking it.",
  },
  "type-checked": {
    label: "Type-checked",
    className: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
    detail: "tsc passes. No test calls the changed code unmocked, so runtime behaviour is not proven.",
  },
  unverified: {
    label: "Unverified",
    className: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    detail: "Neither the type check nor an exercising test passed. Review carefully.",
  },
};

export function VerificationBadge({ verification }: { verification: Verification }) {
  const v = VERIFICATION_TEXT[verification];
  return <span className={cx("inline-flex items-center rounded-md px-2.5 py-1 text-sm font-semibold ring-1 ring-inset", v.className)}>{v.label}</span>;
}

// "in 6 days · Oct 23, 2026"
export function deadlineText(date?: string): string | undefined {
  if (!date) return undefined;
  const d = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const pretty = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const rel = days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : `${-days} days ago`;
  return `${rel} · ${pretty}`;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)} aria-hidden />;
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("rounded-xl border border-zinc-800 bg-zinc-900/50", className)}>{children}</div>;
}

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{children}</div>;
}
