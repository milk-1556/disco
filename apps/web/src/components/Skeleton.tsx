/** Shimmer placeholders for loading states (the .skel utility lives in index.css). */
export function Skeleton({ w = '100%', h = 14, className = '', style }: { w?: number | string; h?: number | string; className?: string; style?: React.CSSProperties }) {
  return <div className={`skel ${className}`} style={{ width: w, height: h, ...style }} />;
}

/** A panel-shaped skeleton card — matches the app's .panel surfaces. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="panel p-5">
      <Skeleton w="38%" h={11} />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} w={i === lines - 1 ? '64%' : '100%'} h={13} />
        ))}
      </div>
    </div>
  );
}

/** A grid of stat-tile skeletons — for dashboards (Economics, Today). */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel-soft px-3 py-3.5">
          <Skeleton w="55%" h={20} />
          <Skeleton w="80%" h={9} className="mt-3" />
        </div>
      ))}
    </div>
  );
}

/** Stacked row skeletons — for lists (Queue, Library cards, deal tables). */
export function SkeletonRows({ count = 3, h = 56 }: { count?: number; h?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} h={h} />
      ))}
    </div>
  );
}
