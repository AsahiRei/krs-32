import { useEffect, useState } from 'react';

class Latest<T> {
  constructor(private value: T) {}

  get() {
    return this.value;
  }

  set(next: T) {
    this.value = next;
  }
}

/**
 * Gives long-lived gesture handlers the newest props. A PanResponder can't be rebuilt mid-drag,
 * so its callbacks read from here instead of closing over one render's values.
 */
export function useLatest<T>(value: T) {
  const [latest] = useState(() => new Latest(value));
  useEffect(() => {
    latest.set(value);
  });
  return latest;
}
