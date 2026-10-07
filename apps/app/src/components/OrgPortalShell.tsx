import { notFound } from 'next/navigation';
import { fetchOrgMe } from '@/lib/org-session';
import {
  initializePortalHandlers,
  getOrgPortalHandler,
} from '@/lib/org-portal-context';
import { listWorkspaces } from '@/lib/workspaces';
import { OrgPortalHeader } from '@/components/OrgPortalHeader';
import './orgportal.css';

/**
 * Shared portal shell for all org types.
 *
 * This is the single implementation of the org portal chrome (session
 * resolution, nav header, workspace switcher, sign-out). Both the dynamic
 * `/org/[type]/[id]` layout and the static per-type branches (`/org/courier`,
 * `/org/hotel`) render through it, so no route module imports another
 * route module — Next.js resolves layouts per-directory, not by re-export.
 */
export default async function OrgPortalShell({
  orgType,
  orgId,
  children,
}: {
  orgType: string;
  orgId: string;
  children: React.ReactNode;
}) {
  // Initialize portal handlers if not already done
  initializePortalHandlers();

  // Get the portal handler for this org type
  const handler = getOrgPortalHandler(orgType);
  if (!handler) {
    notFound();
  }

  // Fetch org session data and metadata in parallel
  const [me, workspaces, metadata] = await Promise.all([
    fetchOrgMe(orgId, orgType).catch((e) => {
      // Tolerant of dead sessions: just render children without chrome
      console.error(`Failed to fetch org session for ${orgType}/${orgId}:`, e);
      return null;
    }),
    // Fetch available workspaces for the workspace switcher
    listWorkspaces(),
    // Fetch org-type-specific metadata if handler provides a fetcher
    handler.fetchMetadata
      ? handler.fetchMetadata(orgId).catch((e) => {
          console.error(`Failed to fetch metadata for ${orgType}/${orgId}:`, e);
          return {};
        })
      : Promise.resolve({}),
  ]);

  // If no session, render children without portal chrome
  if (!me) {
    return <>{children}</>;
  }

  // Get navigation items from handler
  const navItems = handler.getNavItems({
    orgId,
    capabilities: me.capabilities || [],
    metadata,
  });

  // Build workspace switcher key
  const currentKey = `${orgType}:${orgId}`;

  // Get portal configuration
  const homeLink = handler.getHomeLink(orgId);
  const signOutAction = handler.getSignOutAction();
  const subtitle = handler.getSubtitle();
  const stylePrefix = handler.stylePrefix;

  return (
    <div className={`${stylePrefix}`}>
      <OrgPortalHeader
        orgType={orgType}
        orgId={orgId}
        orgName={me.org.name}
        orgSubtitle={subtitle}
        navItems={navItems}
        workspaces={workspaces}
        currentKey={currentKey}
        signOutAction={signOutAction}
        homeLink={homeLink}
        stylePrefix={stylePrefix}
      />

      <div className={`${stylePrefix}-wrap`}>{children}</div>
    </div>
  );
}