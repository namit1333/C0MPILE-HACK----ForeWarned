import { Suspense } from "react";
import { Spinner } from "../../ui";
import RepoView from "./repo-view";

// The repo id is only known at request time, so the client view sits inside Suspense (required with cacheComponents).
export default function RepoPage() {
  return (
    <Suspense fallback={<p className="flex items-center gap-2 text-sm text-zinc-500"><Spinner /> Loading…</p>}>
      <RepoView />
    </Suspense>
  );
}
