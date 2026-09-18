'use client';

/**
 * Shared "somebody is filling in a form" signal for the parcel-org
 * dashboard. The dashboard auto-refreshes (see DropoffPoll) so a front
 * desk tablet sees new drop-offs without anyone hitting reload — but
 * that same refresh churns the whole subtree while somebody is midway
 * through the custom-parcel or cash-count form, which reads as "the
 * section keeps loading" and can wipe what they already typed.
 *
 * Panels call setFormActive(true) while open and false on close/unmount
 * (reference-counted so two open panels don't cancel each other out);
 * DropoffPoll skips its refresh while any panel reports active.
 */
export const FORM_ACTIVE_EVENT = 'parcel-org:form-active';

let activeCount = 0;

export function setFormActive(active: boolean) {
  activeCount = Math.max(0, activeCount + (active ? 1 : -1));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<{ active: boolean }>(FORM_ACTIVE_EVENT, {
        detail: { active: activeCount > 0 },
      }),
    );
  }
}
