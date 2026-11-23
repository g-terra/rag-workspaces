import { createContext, use } from 'react';

export interface TourContextValue {
  /** Open the walkthrough from its first step (Help → Show the walkthrough). */
  start(): void;
}

export const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = use(TourContext);
  if (!ctx) throw new Error('useTour must be used inside <TourProvider>');
  return ctx;
}
