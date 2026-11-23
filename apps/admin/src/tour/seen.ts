type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const key = (sub: string) => `rw.tourSeen.${sub}`;

// Storage can be blocked (private windows, site settings). The flag is only a hint: if it can't be read
// the tour shows again, which is harmless.
function defaultStorage(): KeyValueStorage {
  return localStorage;
}

/** Whether this account (Keycloak `sub`) has already finished or skipped the walkthrough in this browser. */
export function hasSeenTour(sub: string, storage?: KeyValueStorage): boolean {
  try {
    return (storage ?? defaultStorage()).getItem(key(sub)) === '1';
  } catch {
    return false;
  }
}

export function markTourSeen(sub: string, storage?: KeyValueStorage): void {
  try {
    (storage ?? defaultStorage()).setItem(key(sub), '1');
  } catch {
    // Nothing to do: the tour shows again next time.
  }
}
