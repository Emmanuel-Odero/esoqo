import { notFound } from 'next/navigation';
import {
  initializePortalHandlers,
  getOrgPortalHandler,
} from '@/lib/org-portal-context';
import { fetchOrgMe } from '@/lib/org-session';

/**
 * Dynamic org portal home page.
 * 
 * This page routes to the appropriate handler based on the org type.
 * Each org type can implement its own dashboard/home page by:
 * 1. Creating type-specific pages in subdirectories (e.g., /org/courier/[id]/dashboard)
 * 2. Or by creating a handler that renders the default dashboard here
 */
export default async function OrgPortalPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const { type: orgType, id: orgId } = await params;

  // Initialize portal handlers if not already done
  initializePortalHandlers();

  // Get the portal handler for this org type
  const handler = getOrgPortalHandler(orgType);
  if (!handler) {
    notFound();
  }

  // Fetch org session data
  const me = await fetchOrgMe(orgId, orgType).catch((e) => {
    console.error(`Failed to fetch org session for ${orgType}/${orgId}:`, e);
    return null;
  });

  if (!me) {
    notFound();
  }

  // For now, render a generic dashboard that can be overridden per org type.
  // Each org type can create type-specific content by adding their own page.tsx files.
  return (
    <div className={`${handler.stylePrefix}-dashboard`}>
      <div className={`${handler.stylePrefix}-dashboard-header`}>
        <h1>Welcome to {me.org.name}</h1>
        <p className={`${handler.stylePrefix}-dashboard-subtitle`}>
          {handler.getSubtitle()}
        </p>
      </div>

      <div className={`${handler.stylePrefix}-dashboard-content`}>
        <div className={`${handler.stylePrefix}-dashboard-section`}>
          <h2>Dashboard</h2>
          <p>Organization type: {orgType}</p>
          <p>Organization ID: {orgId}</p>
          <p>
            This is a generic org portal dashboard. Create type-specific pages to
            customize the experience for each org type.
          </p>
        </div>

        <div className={`${handler.stylePrefix}-dashboard-section`}>
          <h3>Capabilities</h3>
          <ul>
            {me.capabilities.map((cap) => (
              <li key={cap}>{cap}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
