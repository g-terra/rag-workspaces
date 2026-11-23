import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/auth-context';
import { hasSeenTour, markTourSeen } from './seen';
import { TourContext } from './tour-context';
import { Walkthrough } from './walkthrough';

/** Holds the walkthrough's current step, and opens it once for an account that hasn't seen it. */
export function TourProvider({ children }: { children: ReactNode }) {
  const { user, me } = useAuth();
  const sub = user?.profile.sub;
  // undefined until the person opens, moves or closes it; until then it opens by itself for an account
  // that hasn't seen it. Waiting for `me` means the admin links it points at are already there.
  const [chosen, setChosen] = useState<number | null | undefined>(undefined);
  const index = chosen !== undefined ? chosen : me && sub && !hasSeenTour(sub) ? 0 : null;

  const close = useCallback(() => {
    if (sub) markTourSeen(sub);
    setChosen(null);
  }, [sub]);
  const value = useMemo(() => ({ start: () => setChosen(0) }), []);

  return (
    <TourContext value={value}>
      {children}
      {index !== null && <Walkthrough index={index} onMove={setChosen} onClose={close} />}
    </TourContext>
  );
}
