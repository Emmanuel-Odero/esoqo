import { SkeletonCard } from '@esoqo/ui';

export default function Loading() {
  return (
    <div className="wrap" style={{ paddingTop: 32, paddingBottom: 48 }} role="status" aria-label="Loading…">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
