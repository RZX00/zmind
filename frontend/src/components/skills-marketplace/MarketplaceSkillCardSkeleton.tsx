import { Skeleton } from "@/components/ui/skeleton";

export function MarketplaceSkillCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/40 bg-card p-5">
      {/* Icon + Name */}
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <Skeleton className="mt-1.5 h-4 w-3/4 rounded" />
      </div>

      {/* Description */}
      <div className="mt-3 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-full rounded" />
        <Skeleton className="h-3.5 w-2/3 rounded" />
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-border/20 pt-3.5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-3 w-10 rounded" />
          <Skeleton className="h-3 w-8 rounded" />
        </div>
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>
    </div>
  );
}

export function MarketplaceSkillGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <MarketplaceSkillCardSkeleton key={index} />
      ))}
    </div>
  );
}
