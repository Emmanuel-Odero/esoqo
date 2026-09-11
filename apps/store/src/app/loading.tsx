import { SkeletonCard } from '@esoko/ui';

export default function Loading() {
  return (
    <div className="wrap" style={{ paddingTop: 32, paddingBottom: 48 }} role="status" aria-label="Loading store…">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    </div>
  );
}
