import type { Metadata } from 'next';
import { getCtx } from '@/lib/session';
import { StartWizard } from './StartWizard';

export const metadata: Metadata = { title: 'Start your page' };
export const dynamic = 'force-dynamic';

export default async function StartPage() {
  const ctx = await getCtx();
  return <StartWizard signedIn={ctx.actorType === 'SUBJECT'} />;
}
