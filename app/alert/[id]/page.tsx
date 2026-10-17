import { Suspense } from "react";
import { Spinner } from "../../ui";
import AlertView from "./alert-view";

export default function AlertPage() {
  return (
    <Suspense fallback={<p className="flex items-center gap-2 text-sm text-zinc-500"><Spinner /> Loading…</p>}>
      <AlertView />
    </Suspense>
  );
}
