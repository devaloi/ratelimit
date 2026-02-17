/**
 * Time mocking utilities for testing rate limiting without real delays.
 */

let mockedTime: number | null = null;

/**
 * Get the current timestamp, using mocked time if set.
 */
export function now(): number {
  return mockedTime ?? Date.now();
}

/**
 * Set mocked time for testing.
 * @param timestamp - The timestamp to use, or null to reset to real time
 */
export function setMockedTime(timestamp: number | null): void {
  mockedTime = timestamp;
}

/**
 * Advance mocked time by a given number of milliseconds.
 * Throws if mocked time is not set.
 * @param ms - Milliseconds to advance
 */
export function advanceTime(ms: number): void {
  if (mockedTime === null) {
    throw new Error('Cannot advance time: mocked time is not set');
  }
  mockedTime += ms;
}

/**
 * Reset mocked time to real time.
 */
export function resetMockedTime(): void {
  mockedTime = null;
}

/**
 * Get a Date object using the current (possibly mocked) time.
 */
export function currentDate(): Date {
  return new Date(now());
}
