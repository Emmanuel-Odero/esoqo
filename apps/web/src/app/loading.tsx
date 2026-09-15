import { SkeletonCard } from '@esoqo/ui';

export default function Loading() {
  return (
    <div className="wrap" style={{ paddingTop: 32, paddingBottom: 48 }} role="status" aria-label="Loading…">
      <div className="grid g3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
