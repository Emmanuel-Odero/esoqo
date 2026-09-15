import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon, Logo } from '@esoqo/ui';
import { goUrl } from '@/lib/ticketing';
import { ParcelStaffSignInForm } from './ParcelStaffSignInForm';

export const dynamic = 'force-dynamic';

async function getOrgBySlug(slug: string): Promise<{ name: string } | null> {
  const res = await fetch(goUrl(`/v1/parcel-orgs/by-slug/${encodeURIComponent(slug)}`), {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { org?: { name: string } } | null;
  return json?.org ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  return {
    title: org ? `Staff sign in — ${org.name}` : 'Courier company not found',
    // Not indexable: this is an internal door, and a search result for
    // "<company> staff sign in" is a roster hint nobody needs.
    robots: { index: false, follow: false },
  };
}

/**
 * A bare, no-owner-session sign-in for a courier company's riders,
 * dispatchers and managers — the parcel equivalent of
 * /org-staff/[slug], and the first door those three personas have ever
 * had. Before this, a partner courier company logged into nothing at
 * all: every parcel lived under Esoqo's own admin console.
 *
 * An admin shares this page's URL (the company's public slug) with
 * staff; each signs in with their own name and their own PIN, never a
 * shared Esoqo account. Companies still in DRAFT don't resolve here at
 * all, so a half-onboarded tenant's URL isn't live before ops says so.
 */
export default async function ParcelStaffSignInPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  return (
    <div className="auth-wrap">
      <header className="auth-brand">
        <Logo />
      </header>
      <div className="auth-card">
        <p className="kicker"><Icon name="truck" size={12} />Courier company staff</p>
        <h1>{org.name}</h1>
        <p className="lead" style={{ marginTop: 6 }}>
          Sign in with your name and the PIN your manager gave you.
        </p>
        <div style={{ marginTop: 22 }}>
          <ParcelStaffSignInForm orgSlug={slug} />
        </div>
      </div>
      <div className="auth-alt">
        <span className="icbox" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
          <Icon name="building" size={21} />
        </span>
        <h2>Sending a parcel instead?</h2>
        <p>Customers book and track at <a href="/">esoqo</a> — this page is for staff.</p>
      </div>
    </div>
  );
}
