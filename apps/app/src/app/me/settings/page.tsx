import { getDisplayPrefs } from '@esoko/db';
import { requireSubject } from '@/lib/session';
import { PrefsPanel } from './PrefsPanel';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const ctx = await requireSubject();
  const prefs = await getDisplayPrefs(ctx);
  return (
    <>
      <div className="mehead">
        <h1>How this looks</h1>
        <p>
          These settings are saved to your record, not to this phone — so they follow you if you
          use a different handset, or borrow someone else’s.
        </p>
      </div>
      <PrefsPanel initial={prefs} />
    </>
  );
}
