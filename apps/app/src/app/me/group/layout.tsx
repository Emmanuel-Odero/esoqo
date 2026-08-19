/** Exists only so revalidatePath('/me/group', 'layout') in this
 *  feature's Server Actions can invalidate the whole /me/group/[orgId]
 *  subtree in one call, without every action needing to know which
 *  orgId(s) it affected. No chrome of its own — /me/layout.tsx already
 *  provides that. */
export default function GroupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
