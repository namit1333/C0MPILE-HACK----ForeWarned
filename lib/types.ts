// lib/types.ts
export type Provider = "openai" | "supabase" | (string & {});

export interface CallSite {
  file: string;        // repo-relative path
  line: number;
  symbol: string;      // "OpenAIApi.createChatCompletion", or a model id
  snippet: string;     // the line(s) of code
  kind: "sdk-call" | "import" | "model-string" | "http-endpoint";
}

export interface Dependency {
  provider: Provider;
  package?: string;    // "openai"; absent for raw HTTP use
  version?: string;    // from the lockfile or package.json
  callSites: CallSite[];
}

export interface Inventory {
  repo: string;        // "owner/name"
  scannedAt: string;   // ISO time
  dependencies: Dependency[];
}

export interface ChangeRecord {
  id: string;          // "openai-node-v4"
  provider: Provider;
  type: "breaking" | "deprecation" | "feature";
  title: string;
  summary: string;     // plain English, shown in the UI
  effectiveDate?: string; // shutdown or sunset date, YYYY-MM-DD
  sourceUrl: string;   // the provider page it came from
  affects: {
    package?: string;
    versionRange?: string; // "<4.0.0"
    symbols?: string[];    // ["OpenAIApi", "createChatCompletion"]
    patterns?: string[];   // regexes, e.g. retired model ids
  };
  migration: string;   // instructions the fix agent follows
}

export interface Alert {
  id: string;
  repo: string;
  changeId: string;
  type: ChangeRecord["type"];
  deadline?: string;
  callSites: CallSite[];
  status: "open" | "fixing" | "pr-opened" | "failed";
}

// Strongest true label wins: tests-exercise-call > type-checked > unverified
export type Verification = "tests-exercise-call" | "type-checked" | "unverified";

export type CheckResult = "pass" | "fail" | "skipped";

export interface FixResult {
  alertId: string;
  branch: string;
  prUrl?: string;
  filesChanged: string[];
  checks: { name: "tsc" | "tests"; before: CheckResult; after: CheckResult }[];
  verification: Verification;
  attempts: number;
  log: string[];       // human-readable steps for the live feed
}
