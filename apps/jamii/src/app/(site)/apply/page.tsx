import type { Metadata } from 'next';
import { ApplyForm } from './ApplyForm';

export const metadata: Metadata = { title: 'Apply to join Our Jamii' };
export const dynamic = 'force-dynamic';

export default async function ApplyPage({
  searchParams,
}: { searchParams: Promise<{ identifier?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="authwrap">
      <p className="kick">Our Jamii</p>
      <h1 style={{ fontSize: '1.6rem', color: 'var(--ink)', margin: '12px 0 22px' }}>
        Apply to join Our Jamii
      </h1>
      <div className="card">
        <p style={{ fontSize: '.86rem', color: '#6b6552', marginBottom: 20 }}>
          Whether you&rsquo;re already a CECF member or brand new, tell us how to reach you and we&rsquo;ll
          review your application. You&rsquo;ll be able to sign in once it&rsquo;s approved.
        </p>
        <ApplyForm initialIdentifier={sp.identifier ?? ''} />
      </div>
    </div>
  );
}
