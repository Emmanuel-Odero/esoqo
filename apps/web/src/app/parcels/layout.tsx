import { ParcelsNav } from './ParcelsNav';

/**
 * Wraps every /parcels route with the section mini-menu, so send, track,
 * points and help are always one tap apart rather than a trip back to
 * the hub.
 */
export default function ParcelsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ParcelsNav />
      {children}
    </>
  );
}
