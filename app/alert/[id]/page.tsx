import { Suspense } from "react";
import AlertPage from "./alert-page";

// params is only known at request time; with cacheComponents the client page must render inside Suspense.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-5xl px-6 py-16 font-mono text-zinc-400">Loading alert...</main>}>
      <AlertPage params={params} />
    </Suspense>
  );
}
