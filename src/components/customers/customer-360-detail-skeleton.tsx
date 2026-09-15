import { Skeleton } from '@/components/dashboard/skeleton';

export function Customer360DetailSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8"
    >
      <Skeleton className="h-8 w-28" />
      <div className="border-border bg-card rounded-2xl border p-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:max-w-sm">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
      <span className="sr-only">Cargando perfil de cliente…</span>
    </div>
  );
}
