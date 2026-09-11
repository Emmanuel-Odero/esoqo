import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Icon, Logo } from '@esoko/ui';
import { goUrl } from '@/lib/ticketing';
import { OrgStaffSignInForm } from './OrgStaffSignInForm';

export const dynamic = 'force-dynamic';

async function getOrgBySlug(slug: string): Promise<{ name: string } | null> {
  const res = await fetch(goUrl(`/v1/ticketorgs/by-slug/${encodeURIComponent(slug)}`), { cache: 'no-store' });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { org?: { name: string } } | null;
  return json?.org ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  return { title: org ? `Staff sign in — ${org.name}` : 'Organiser not found' };
}

/**
 * A bare, no-owner-session sign-in for gate scanners and org managers —
 * the ticketing equivalent of apps/store's /signin/cashier/[slug]. An
 * admin shares this page's URL (org slug, public) with staff; each
 * signs in with their own name and org-scoped PIN, never the owner's
 * Esoko account.
 */
export default async function OrgStaffSignInPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  return (
    <div className="auth-wrap">
      <header className="auth-brand">
        <Logo />
      </header>
      <div className="auth-card">
        <p className="kicker"><Icon name="keypad" size={12} />Organiser staff</p>
        <h1>{org.name}</h1>
        <p className="lead" style={{ marginTop: 6 }}>
          Sign in with your name and the PIN the organiser gave you.
        </p>
        <div style={{ marginTop: 22 }}>
          <OrgStaffSignInForm orgSlug={slug} />
        </div>
      </div>
      <div className="auth-alt">
        <span className="icbox" style={{ background: 'var(--blue-t)', color: 'var(--blue)' }}>
          <Icon name="building" size={21} />
        </span>
        <h2>Not staff here?</h2>
        <p>The organiser's owner signs in <a href="/signin">on their Esoko account</a> instead.</p>
      </div>
    </div>
  );
}
