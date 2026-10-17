import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph";
import type { CallSite, Dependency, Inventory, Provider } from "../types";

// Known API SDKs: package name -> provider.
export const KNOWN_SDKS: Record<string, Provider> = {
  openai: "openai",
  "@supabase/supabase-js": "supabase",
  stripe: "stripe",
  "@anthropic-ai/sdk": "anthropic",
  resend: "resend",
  twilio: "twilio",
};

// API hosts -> provider, for raw fetch/axios use.
const KNOWN_HOSTS: [RegExp, Provider][] = [
  [/(^|\.)api\.openai\.com$/, "openai"],
  [/\.supabase\.co$/, "supabase"],
  [/(^|\.)api\.stripe\.com$/, "stripe"],
  [/(^|\.)api\.anthropic\.com$/, "anthropic"],
  [/(^|\.)api\.resend\.com$/, "resend"],
  [/(^|\.)api\.twilio\.com$/, "twilio"],
];

// Strings that look like OpenAI model ids.
export const OPENAI_MODEL_RE =
  /^(gpt-[\w.-]+|chatgpt-[\w.-]+|o[1-9](-[\w.-]+)?|text-(davinci|curie|babbage|ada)-\d+|code-davinci-\d+|text-embedding-[\w.-]+|text-moderation-[\w.-]+|davinci(-\d+)?|babbage(-\d+)?|whisper-1|dall-e-\d|tts-1(-hd)?(-\d+)?|omni-moderation-[\w.-]+)$/;

// Factory functions whose return value is an SDK client.
const FACTORY_LABELS: Record<string, string> = { createClient: "SupabaseClient" };

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
// Build output, vendored code, and tests/examples/fixtures/docs: none of it is the app calling an API in production.
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".turbo", ".vercel", "vendor", "third_party",
  "test", "tests", "__tests__", "__mocks__", "__fixtures__", "fixtures", "testProjects", "e2e", "cypress",
  "examples", "example", "docs", "benchmarks", "bench", "storybook-static",
]);
const SKIP_FILE = /\.(test|spec|stories|e2e|bench)\.[cm]?[jt]sx?$|\.min\.js$|\.d\.[cm]?ts$/;
const SKIP_JSON = new Set(["package.json", "package-lock.json", "tsconfig.json", "jsconfig.json", "pnpm-lock.yaml", "yarn.lock"]);
// Parsing every file of a huge monorepo exhausts memory, so only files that can matter are parsed, up to this many.
const MAX_PARSED_FILES = 2500;
// A file naming more distinct model ids than this is a model catalog or pricing table, not code calling them.
const MAX_MODEL_IDS_PER_FILE = 15;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/@-]/g, (c) => `\\${c}`);
// Cheap text pre-filters, run before any parsing.
const SDK_TEXT_RE = new RegExp(`["'\`](${Object.keys(KNOWN_SDKS).map(escapeRe).join("|")})["'\`]`);
const MODEL_TEXT_RE = /["'`](gpt-|chatgpt-|o[1-9]["'`-]|text-(davinci|curie|babbage|ada|embedding|moderation)|code-davinci|davinci|babbage|whisper-1|dall-e-|tts-1|omni-moderation)/;
const KNOWN_HOST_TEXT_RE = /api\.openai\.com|\.supabase\.co|api\.stripe\.com|api\.anthropic\.com|api\.resend\.com|api\.twilio\.com/;
const HTTP_CALL_TEXT_RE = /\b(fetch|axios|got|ky|\$fetch)\b/;
const RELATIVE_IMPORT_RE = /(?:from\s+|import\(\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const PLACEHOLDER_HOST = /^(localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|\[::1\])$|(^|\.)example\.(com|org|net)$|\.(invalid|test|example|localhost|local|internal)$/;

const LANGUAGES: [RegExp, string][] = [
  [/\.py$/, "Python"], [/\.go$/, "Go"], [/\.rb$/, "Ruby"], [/\.(java|kt)$/, "Java/Kotlin"],
  [/\.rs$/, "Rust"], [/\.php$/, "PHP"], [/\.cs$/, "C#"], [/\.swift$/, "Swift"],
];

async function walk(dir: string, root: string, out: string[] = []): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name) && !ent.name.startsWith(".")) await walk(path.join(dir, ent.name), root, out);
    } else if (ent.isFile() && !SKIP_FILE.test(ent.name)) {
      out.push(path.relative(root, path.join(dir, ent.name)));
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped package.json / lockfile shapes
async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

// Resolved versions: lockfile first, then the package.json range.
// Monorepos declare SDKs in workspace package.json files (apps/web/package.json), so all of them count.
async function packageVersions(dir: string, packageJsons: string[], skip: Set<string>): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  const declared: Record<string, string> = {};
  for (const rel of ["package.json", ...packageJsons.filter((p) => p !== "package.json")]) {
    const pkg = await readJson(path.join(dir, rel));
    for (const [name, range] of Object.entries({ ...pkg?.devDependencies, ...pkg?.dependencies })) {
      if (!(name in declared) && typeof range === "string" && !range.startsWith("workspace:")) declared[name] = range;
    }
  }
  const lock = await readJson(path.join(dir, "package-lock.json"));
  let yarnLock = "";
  let pnpmLock = "";
  try { yarnLock = await readFile(path.join(dir, "yarn.lock"), "utf8"); } catch {}
  try { pnpmLock = await readFile(path.join(dir, "pnpm-lock.yaml"), "utf8"); } catch {}

  for (const name of Object.keys(KNOWN_SDKS)) {
    if (!(name in declared) || skip.has(name)) continue;
    let v: string | undefined =
      lock?.packages?.[`node_modules/${name}`]?.version ?? lock?.dependencies?.[name]?.version;
    if (!v && yarnLock) {
      const esc = name.replace(/[/@.]/g, (c) => `\\${c}`);
      v = yarnLock.match(new RegExp(`^"?${esc}@[^\\n]*:\\n\\s+version:? "?([^"\\n]+)"?`, "m"))?.[1];
    }
    if (!v && pnpmLock) {
      const esc = name.replace(/[/@.]/g, (c) => `\\${c}`);
      v = pnpmLock.match(new RegExp(`^\\s+'?/?${esc}@(\\d[^:('\\s]*)`, "m"))?.[1];
    }
    versions.set(name, v ?? declared[name]);
  }
  return versions;
}

function lineText(sf: SourceFile, line: number): string {
  return (sf.getFullText().split("\n")[line - 1] ?? "").trim();
}

function hostProvider(url: string): Provider | undefined {
  try {
    const host = new URL(url).hostname;
    if (!host.includes(".") || PLACEHOLDER_HOST.test(host)) return undefined;
    for (const [re, p] of KNOWN_HOSTS) if (re.test(host)) return p;
    return host;
  } catch {
    return undefined;
  }
}

interface Found {
  provider: Provider;
  pkg?: string;
  site: CallSite;
}

type Client = { pkg: string; label: string; factory?: boolean }; // factory: a function that returns the client
// Clients exported by each file, keyed by repo-relative path without extension: file -> export name -> client.
type ExportedClients = Map<string, Map<string, Client>>;

const moduleKey = (rel: string) => rel.replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");

function scanSourceFile(sf: SourceFile, rel: string, known: ExportedClients): { found: Found[]; exported: Map<string, Client> } {
  const found: Found[] = [];
  const site = (node: Node, symbol: string, kind: CallSite["kind"]): CallSite => {
    const line = node.getStartLineNumber();
    return { file: rel, line, symbol, snippet: lineText(sf, line), kind };
  };

  // 1. Imports (ESM and require) of known SDKs. local name -> { pkg, exported name }
  const imported = new Map<string, { pkg: string; name: string }>();
  for (const imp of sf.getImportDeclarations()) {
    const pkg = imp.getModuleSpecifierValue();
    if (!(pkg in KNOWN_SDKS)) continue;
    const names: string[] = [];
    const def = imp.getDefaultImport();
    if (def) { imported.set(def.getText(), { pkg, name: "default" }); names.push(def.getText()); }
    const ns = imp.getNamespaceImport();
    if (ns) { imported.set(ns.getText(), { pkg, name: "*" }); names.push(ns.getText()); }
    for (const n of imp.getNamedImports()) {
      const local = n.getAliasNode()?.getText() ?? n.getName();
      imported.set(local, { pkg, name: n.getName() });
      names.push(n.getName());
    }
    found.push({ provider: KNOWN_SDKS[pkg], pkg, site: site(imp, names.join(",") || pkg, "import") });
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "require") continue;
    const arg = call.getArguments()[0];
    if (!arg || !Node.isStringLiteral(arg) || !(arg.getLiteralValue() in KNOWN_SDKS)) continue;
    const pkg = arg.getLiteralValue();
    const decl = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    const names: string[] = [];
    const nameNode = decl?.getNameNode();
    if (nameNode && Node.isObjectBindingPattern(nameNode)) {
      for (const el of nameNode.getElements()) {
        const exported = el.getPropertyNameNode()?.getText() ?? el.getName();
        imported.set(el.getName(), { pkg, name: exported });
        names.push(exported);
      }
    } else if (nameNode && Node.isIdentifier(nameNode)) {
      imported.set(nameNode.getText(), { pkg, name: "default" });
      names.push(nameNode.getText());
    }
    found.push({ provider: KNOWN_SDKS[pkg], pkg, site: site(call, names.join(",") || pkg, "import") });
  }

  // 2. Clients: variables/properties initialised with `new Imported(...)` or `importedFactory(...)`,
  //    plus clients imported from other files in the repo (e.g. `import { openai } from "./client"`).
  const clients = new Map<string, Client>();
  const factories = new Map<string, Client>(); // getStripeClient(), getOpenAI(): functions that return a client
  const bind = (local: string, c: Client) => (c.factory ? factories : clients).set(local, c);
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (!spec.startsWith(".")) continue;
    const exports = known.get(moduleKey(path.normalize(path.join(path.dirname(rel), spec))));
    if (!exports) continue;
    const def = imp.getDefaultImport();
    if (def && exports.has("default")) bind(def.getText(), exports.get("default")!);
    for (const n of imp.getNamedImports()) {
      const c = exports.get(n.getName());
      if (c) bind(n.getAliasNode()?.getText() ?? n.getName(), c);
    }
  }
  const labelFor = (local: string) => {
    const info = imported.get(local)!;
    const exported = info.name === "default" || info.name === "*" ? local : info.name;
    return FACTORY_LABELS[exported] ?? exported;
  };
  const clientInit = (init: Node | undefined): Client | undefined => {
    if (!init) return undefined;
    init = Node.isAwaitExpression(init) ? init.getExpression() : init;
    if (Node.isNewExpression(init) || Node.isCallExpression(init)) {
      const callee = init.getExpression().getText();
      const root = callee.split(".")[0];
      if (imported.has(root)) return { pkg: imported.get(root)!.pkg, label: labelFor(root) + (callee.includes(".") ? callee.slice(root.length) : "") };
      if (Node.isCallExpression(init) && factories.has(callee)) return { ...factories.get(callee)!, factory: false };
    }
    return undefined;
  };
  // Local factories: functions whose body constructs a client (`const getStripe = () => new Stripe(key)`).
  for (const fn of [...sf.getFunctions(), ...sf.getVariableDeclarations()]) {
    const name = fn.getName();
    const body = Node.isVariableDeclaration(fn) ? fn.getInitializer() : fn;
    if (!name || !body || !(Node.isFunctionDeclaration(body) || Node.isArrowFunction(body) || Node.isFunctionExpression(body))) continue;
    for (const n of [...body.getDescendantsOfKind(SyntaxKind.NewExpression), ...body.getDescendantsOfKind(SyntaxKind.CallExpression)]) {
      const c = clientInit(n);
      if (c) { factories.set(name, { ...c, factory: true }); break; }
    }
  }
  for (const d of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const c = clientInit(d.getInitializer());
    if (c && Node.isIdentifier(d.getNameNode())) clients.set(d.getName(), c);
  }
  for (const p of sf.getDescendantsOfKind(SyntaxKind.PropertyDeclaration)) {
    const c = clientInit(p.getInitializer());
    if (c) clients.set(p.getName(), c);
  }
  for (const b of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (b.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const c = clientInit(b.getRight());
    if (!c) continue;
    const left = b.getLeft().getText().replace(/^this\./, "");
    if (/^[\w$]+$/.test(left)) clients.set(left, c);
  }

  // 3. Calls: member calls on clients, and direct calls/constructions of imported symbols.
  for (const node of [
    ...sf.getDescendantsOfKind(SyntaxKind.CallExpression),
    ...sf.getDescendantsOfKind(SyntaxKind.NewExpression),
  ]) {
    const expr = node.getExpression();
    // `getStripe().checkout.sessions.create()` calls straight through a factory.
    const text = expr.getText().replace(/\s+/g, "").replace(/^this\./, "").replace(/\?\./g, ".").replace(/^([\w$]+)\(\)\./, (m, f) => (factories.has(f) ? `${f}.` : m));
    if (text === "require") continue;
    const parts = text.split(".");
    if (!parts.every((p) => /^[\w$]+$/.test(p))) continue;
    const root = parts[0];
    const viaClient = clients.get(root) ?? (parts.length > 1 && factories.has(root) && /^[\w$]+\(\)\./.test(expr.getText().replace(/\s+/g, "")) ? factories.get(root) : undefined);
    if (viaClient && parts.length > 1) {
      const c = viaClient;
      found.push({ provider: KNOWN_SDKS[c.pkg], pkg: c.pkg, site: site(node, [c.label, ...parts.slice(1)].join("."), "sdk-call") });
    } else if (imported.has(root)) {
      const info = imported.get(root)!;
      const sym = [labelFor(root), ...parts.slice(1)].join(".");
      found.push({ provider: KNOWN_SDKS[info.pkg], pkg: info.pkg, site: site(node, Node.isNewExpression(node) ? `new ${sym}` : sym, "sdk-call") });
    }
  }

  // 4. String literals: OpenAI model ids and external API URLs.
  const strings = [
    ...sf.getDescendantsOfKind(SyntaxKind.StringLiteral),
    ...sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral),
    ...sf.getDescendantsOfKind(SyntaxKind.TemplateHead),
  ];
  for (const s of strings) {
    if (s.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)) continue;
    // `type Model = "gpt-4" | ...` lists model ids; it isn't a call that breaks.
    if (s.getParentIfKind(SyntaxKind.LiteralType)) continue;
    const value = Node.isTemplateHead(s) ? s.getText().slice(1, -2) : s.getLiteralValue();
    if (OPENAI_MODEL_RE.test(value)) {
      found.push({ provider: "openai", site: site(s, value, "model-string") });
    } else if (/^https?:\/\//.test(value)) {
      const provider = hostProvider(value);
      if (!provider) continue;
      const known = KNOWN_HOSTS.some(([, p]) => p === provider);
      // Unknown hosts count only when the URL is passed to fetch/axios/got.
      const inHttpCall = s.getAncestors().some(
        (a) => Node.isCallExpression(a) && /^(fetch|axios(\.\w+)?|got(\.\w+)?|ky(\.\w+)?|\$fetch)$/.test(a.getExpression().getText()),
      );
      if (known || inHttpCall) found.push({ provider, site: site(s, value.split("?")[0], "http-endpoint") });
    }
  }

  const exported = new Map<string, Client>();
  for (const [name, decls] of sf.getExportedDeclarations()) {
    for (const d of decls) {
      const local = Node.isVariableDeclaration(d) || Node.isPropertyDeclaration(d) || Node.isFunctionDeclaration(d) ? d.getName() : undefined;
      if (local && clients.has(local)) exported.set(name, clients.get(local)!);
      else if (local && factories.has(local)) exported.set(name, factories.get(local)!);
    }
  }
  return { found, exported };
}

// Line-based fallback for files ts-morph can't handle, and for JSON config files.
function scanTextFallback(text: string, rel: string, sourceFile: boolean): Found[] {
  const found: Found[] = [];
  const lines = text.split("\n");
  lines.forEach((ln, i) => {
    const snippet = ln.trim();
    const at = (symbol: string, kind: CallSite["kind"]): CallSite => ({ file: rel, line: i + 1, symbol, snippet, kind });
    for (const m of ln.matchAll(/["'`]([\w.-]+)["'`]/g)) {
      if (OPENAI_MODEL_RE.test(m[1])) found.push({ provider: "openai", site: at(m[1], "model-string") });
    }
    if (!sourceFile) return;
    for (const pkg of Object.keys(KNOWN_SDKS)) {
      const esc = pkg.replace(/[/@.]/g, (c) => `\\${c}`);
      if (new RegExp(`(from\\s+|require\\()\\s*["']${esc}["']`).test(ln)) found.push({ provider: KNOWN_SDKS[pkg], pkg, site: at(pkg, "import") });
    }
    const m = ln.match(/\b(\w+)\.(create\w+|chat\.completions\.create|completions\.create|embeddings\.create|images\.\w+|audio\.\w+\.\w+)\s*\(/);
    if (m) found.push({ provider: "openai", pkg: "openai", site: at(`${m[1]}.${m[2]}`, "sdk-call") });
  });
  return found;
}

export interface ScanResult {
  inventory: Inventory;
  notes: string[]; // shown above the inventory: unsupported language, skipped self-SDK, partial scan
}

export async function scanRepo(dir: string, repo: string): Promise<Inventory> {
  return (await scanRepoDetailed(dir, repo)).inventory;
}

export async function scanRepoDetailed(dir: string, repo: string): Promise<ScanResult> {
  const files = await walk(dir, dir);
  const notes: string[] = [];

  // A provider's own SDK repo (openai-node, stripe-node) "uses" its SDK everywhere; skip that provider.
  const packageJsons = files.filter((f) => path.basename(f) === "package.json");
  const ownPackages = new Set<string>();
  for (const rel of packageJsons) {
    const name = (await readJson(path.join(dir, rel)))?.name;
    if (typeof name === "string" && name in KNOWN_SDKS) ownPackages.add(name);
  }
  const ownProviders = new Set([...ownPackages].map((p) => KNOWN_SDKS[p]));
  for (const p of ownPackages) notes.push(`This repo publishes the ${p} SDK itself, so its own ${KNOWN_SDKS[p]} usage is skipped.`);

  const versions = await packageVersions(dir, packageJsons, ownPackages);

  // Language check: we read JS/TS (plus JSON config) only.
  const jsTs = files.filter((f) => SOURCE_EXT.test(f)).length;
  const other = LANGUAGES.map(([re, lang]) => ({ lang, n: files.filter((f) => re.test(f)).length })).sort((a, b) => b.n - a.n)[0];
  if (other.n > 0 && jsTs < other.n / 4) {
    notes.push(`This looks like a ${other.lang} repo. Forewarned reads JavaScript/TypeScript today, so only ${jsTs ? "its few JS/TS files and " : ""}JSON config files were checked.`);
  }

  // Pre-filter by text, then parse only candidates, plus files importing a client from a candidate.
  const found: Found[] = [];
  const priority = new Map<string, number>(); // 0 = imports an SDK, 1 = model ids / API URLs
  const relImports = new Map<string, string[]>(); // file -> module keys it imports relatively
  for (const rel of files) {
    const abs = path.join(dir, rel);
    if (SOURCE_EXT.test(rel)) {
      const text = await readFile(abs, "utf8");
      if (text.length > 500_000) continue;
      if (SDK_TEXT_RE.test(text)) priority.set(rel, 0);
      else if (MODEL_TEXT_RE.test(text) || KNOWN_HOST_TEXT_RE.test(text) || (/https?:\/\//.test(text) && HTTP_CALL_TEXT_RE.test(text))) priority.set(rel, 1);
      const keys = [...text.matchAll(RELATIVE_IMPORT_RE)].map((m) => moduleKey(path.normalize(path.join(path.dirname(rel), m[1]))));
      if (keys.length) relImports.set(rel, keys);
    } else if (rel.endsWith(".json") && !SKIP_JSON.has(path.basename(rel))) {
      const text = await readFile(abs, "utf8");
      if (text.length < 200_000 && MODEL_TEXT_RE.test(text)) found.push(...scanTextFallback(text, rel, false));
    }
  }

  let candidates = [...priority.keys()].sort((a, b) => priority.get(a)! - priority.get(b)!);
  if (candidates.length > MAX_PARSED_FILES) {
    notes.push(`Large repo: checked the ${MAX_PARSED_FILES} most relevant of ${candidates.length} candidate files.`);
    candidates = candidates.slice(0, MAX_PARSED_FILES);
  }

  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true },
  });
  const parsed = new Map<string, SourceFile | null>(); // null = parse failed, use the text fallback
  const parse = async (rel: string) => {
    if (parsed.has(rel)) return;
    const text = await readFile(path.join(dir, rel), "utf8");
    try {
      parsed.set(rel, project.createSourceFile(`/${rel}`, text, { overwrite: true }));
    } catch {
      parsed.set(rel, null);
      found.push(...scanTextFallback(text, rel, true));
    }
  };
  for (const rel of candidates) await parse(rel);

  // Passes until exported clients stop changing; each pass also pulls in files that import a newly found client module.
  const known: ExportedClients = new Map();
  let results: Found[][] = [];
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    results = [...parsed].flatMap(([rel, sf]) => {
      if (!sf) return [];
      try {
        const r = scanSourceFile(sf, rel, known);
        const key = moduleKey(rel);
        if (r.exported.size && r.exported.size !== known.get(key)?.size) {
          known.set(key, r.exported);
          changed = true;
        }
        return [r.found];
      } catch {
        return [scanTextFallback(sf.getFullText(), rel, true)];
      }
    });
    if (!changed) break;
    for (const [rel, keys] of relImports) {
      if (!parsed.has(rel) && parsed.size < MAX_PARSED_FILES + 500 && keys.some((k) => known.has(k))) await parse(rel);
    }
  }
  found.push(...results.flat());

  const idsPerFile = new Map<string, Set<string>>();
  for (const f of found) {
    if (f.site.kind === "model-string") idsPerFile.set(f.site.file, (idsPerFile.get(f.site.file) ?? new Set()).add(f.site.symbol));
  }
  const catalogs = new Set([...idsPerFile].filter(([, ids]) => ids.size > MAX_MODEL_IDS_PER_FILE).map(([file]) => file));
  if (catalogs.size) {
    const sample = [...catalogs].slice(0, 2).join(", ");
    notes.push(`Skipped ${catalogs.size} model catalog file${catalogs.size === 1 ? "" : "s"} (lists of model ids, not calls): ${sample}${catalogs.size > 2 ? ", ..." : ""}.`);
  }

  // Group into dependencies. Model strings and known-host URLs attach to the provider's SDK dependency when present.
  const deps = new Map<string, Dependency>();
  const sdkKeyFor = (provider: Provider) => Object.keys(KNOWN_SDKS).find((p) => KNOWN_SDKS[p] === provider && versions.has(p));
  for (const pkg of versions.keys()) {
    deps.set(`${KNOWN_SDKS[pkg]}|${pkg}`, { provider: KNOWN_SDKS[pkg], package: pkg, version: versions.get(pkg), callSites: [] });
  }
  const seen = new Set<string>();
  for (const f of found) {
    if (ownProviders.has(f.provider)) continue;
    if (f.site.kind === "model-string" && catalogs.has(f.site.file)) continue;
    const pkg = f.pkg ?? sdkKeyFor(f.provider);
    const key = `${f.provider}|${pkg ?? ""}`;
    if (!deps.has(key)) deps.set(key, { provider: f.provider, ...(pkg ? { package: pkg, version: versions.get(pkg) } : {}), callSites: [] });
    const dedupe = `${key}|${f.site.file}|${f.site.line}|${f.site.symbol}|${f.site.kind}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    deps.get(key)!.callSites.push(f.site);
  }

  const dependencies = [...deps.values()]
    .filter((d) => d.callSites.length > 0 || d.package)
    .map((d) => ({ ...d, callSites: d.callSites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line) }))
    .sort((a, b) => b.callSites.length - a.callSites.length);

  return { inventory: { repo, scannedAt: new Date().toISOString(), dependencies }, notes };
}

export function inventoryStats(inv: Inventory): { apis: number; callSites: number } {
  return {
    apis: inv.dependencies.length,
    callSites: inv.dependencies.reduce((n, d) => n + d.callSites.filter((c) => c.kind !== "import").length, 0),
  };
}
