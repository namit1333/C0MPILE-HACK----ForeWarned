"use client";

import type { Inventory } from "@/lib/types";

type Props = {
  inventory: Inventory;
};

export function InventorySection({ inventory }: Props) {
  const totalSites = inventory.dependencies.reduce((n, d) => n + d.callSites.length, 0);

  return (
    <section className="fw-rise border-t border-line pt-12" aria-labelledby="inventory-heading">
      <div className="mb-6 max-w-2xl">
        <p className="mb-2 font-[family-name:var(--font-display)] text-xs uppercase tracking-[0.18em] text-teal">
          Inventory
        </p>
        <h2 id="inventory-heading" className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-ink sm:text-4xl">
          What this repo calls
        </h2>
        <p className="mt-3 text-ink-soft">
          {inventory.dependencies.length} API{inventory.dependencies.length === 1 ? "" : "s"} · {totalSites} call site
          {totalSites === 1 ? "" : "s"} · scanned {new Date(inventory.scannedAt).toLocaleString()}
        </p>
      </div>

      <div className="fw-stagger space-y-8">
        {inventory.dependencies.map((dep) => (
          <div key={`${dep.provider}-${dep.package ?? "http"}`} className="border-l-2 border-teal/40 pl-4 sm:pl-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-[family-name:var(--font-display)] text-xl text-ink">{dep.provider}</h3>
              {dep.package ? (
                <code className="font-[family-name:var(--font-mono)] text-sm text-ink-soft">
                  {dep.package}
                  {dep.version ? `@${dep.version}` : ""}
                </code>
              ) : null}
            </div>
            <ul className="mt-3 space-y-2">
              {dep.callSites.map((site, i) => (
                <li key={`${site.file}:${site.line}:${i}`} className="text-sm leading-relaxed">
                  <div className="flex flex-wrap gap-x-2 text-ink-soft">
                    <span className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-wide text-teal-deep/80">
                      {site.kind}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-xs">
                      {site.file}:{site.line}
                    </span>
                  </div>
                  <p className="mt-0.5 font-[family-name:var(--font-mono)] text-[13px] text-ink">{site.symbol}</p>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-[family-name:var(--font-mono)] text-[12px] text-ink-soft/90">
                    {site.snippet}
                  </pre>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {inventory.dependencies.length === 0 ? (
          <p className="text-ink-soft">No known third-party API usage found in this scan.</p>
        ) : null}
      </div>
    </section>
  );
}
