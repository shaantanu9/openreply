import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared route-segment loading skeleton. Rendered by each dynamic route's
 * loading.tsx so client-side navigation shows an instant, branded placeholder
 * instead of a frozen/blank screen while the server (sin1) responds. This is
 * the single biggest perceived-speed win for the dynamic app pages.
 */
export function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/60 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-5/6" />
            <Skeleton className="mt-6 h-9 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default PageLoading;
