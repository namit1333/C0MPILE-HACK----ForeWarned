import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { z } from "zod";
import type { Alert, CallSite, ChangeRecord, Inventory } from "./types";

const ChangeRecordSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  type: z.enum(["breaking", "deprecation", "feature"]),
  title: z.string(),
  summary: z.string(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sourceUrl: z.string().url(),
  affects: z.object({
    package: z.string().optional(),
    versionRange: z.string().optional(),
    symbols: z.array(z.string()).optional(),
    patterns: z.array(z.string()).optional(),
  }),
  migration: z.string(),
});

export const CHANGES_DIR = path.join(process.cwd(), "data", "changes");

// Loads every data/changes/*.json (a file may hold one record or an array). Invalid files are reported, not fatal.
export async function loadChanges(dir = CHANGES_DIR, onWarn: (msg: string) => void = console.warn): Promise<ChangeRecord[]> {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: ChangeRecord[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(await readFile(path.join(dir, f), "utf8"));
      for (const r of Array.isArray(raw) ? raw : [raw]) out.push(ChangeRecordSchema.parse(r) as ChangeRecord);
    } catch (e) {
      onWarn(`Skipping invalid change record ${f}: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    }
  }
  return out;
}

function versionMatches(version: string | undefined, range: string | undefined): boolean {
  if (!range) return true;
  if (!version) return true; // unknown version: warn rather than miss a breaking change
  const v = semver.valid(version) ?? semver.minVersion(version)?.version ?? semver.coerce(version)?.version;
  return v ? semver.satisfies(v, range, { includePrerelease: true }) : true;
}

function symbolMatches(site: CallSite, symbols: string[]): boolean {
  const tokens = new Set(site.symbol.replace(/^new\s+/, "").split(/[.,\s]+/).filter(Boolean));
  return symbols.some((s) => tokens.has(s) || site.symbol === s);
}

function patternMatches(site: CallSite, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(site.symbol) || re.test(site.snippet));
}

export function alertId(repo: string, changeId: string): string {
  return `${repo.replace(/[^\w.-]+/g, "_")}--${changeId}`;
}

export function match(inventory: Inventory, changes: ChangeRecord[]): Alert[] {
  const alerts: Alert[] = [];
  for (const change of changes) {
    const { package: pkg, versionRange, symbols = [], patterns = [] } = change.affects;
    const regexes = patterns.flatMap((p) => {
      try { return [new RegExp(p)]; } catch { return []; }
    });
    const deps = inventory.dependencies.filter(
      (d) => d.provider === change.provider && (!pkg || d.package === pkg) && versionMatches(d.version, versionRange),
    );
    // Patterns (e.g. retired model ids) can appear outside the SDK dependency, so also check same-provider deps without the package filter.
    const patternDeps = regexes.length
      ? inventory.dependencies.filter((d) => d.provider === change.provider && !deps.includes(d))
      : [];

    const sites: CallSite[] = [];
    for (const d of deps) {
      for (const s of d.callSites) {
        if (!symbols.length && !regexes.length) sites.push(s);
        else if ((symbols.length && symbolMatches(s, symbols)) || (regexes.length && patternMatches(s, regexes))) sites.push(s);
      }
    }
    for (const d of patternDeps) for (const s of d.callSites) if (patternMatches(s, regexes)) sites.push(s);

    if (!sites.length) continue;
    alerts.push({
      id: alertId(inventory.repo, change.id),
      repo: inventory.repo,
      changeId: change.id,
      type: change.type,
      ...(change.effectiveDate ? { deadline: change.effectiveDate } : {}),
      callSites: sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
      status: "open",
    });
  }
  // "What's coming": dated items first by deadline, then breaking > deprecation > feature.
  const rank = { breaking: 0, deprecation: 1, feature: 2 } as const;
  return alerts.sort(
    (a, b) =>
      (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31") || rank[a.type] - rank[b.type],
  );
}
