/**
 * Time unit suffixes and their millisecond values.
 */
const TIME_UNITS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Parse a window string (e.g., '15m', '1h', '1d') into milliseconds.
 *
 * @param window - Time window string with format: number followed by unit (s, m, h, d)
 * @returns Duration in milliseconds
 * @throws Error if the format is invalid
 *
 * @example
 * parseWindow('15m') // 900000
 * parseWindow('1h')  // 3600000
 * parseWindow('1d')  // 86400000
 * parseWindow('30s') // 30000
 */
export function parseWindow(window: string): number {
  if (typeof window !== 'string' || window.length === 0) {
    throw new Error('Window must be a non-empty string');
  }

  const trimmed = window.trim().toLowerCase();

  // Match number (integer or decimal) followed by unit
  const match = /^(\d+(?:\.\d+)?)\s*([smhd])$/.exec(trimmed);

  if (match === null) {
    throw new Error(
      `Invalid window format: "${window}". Expected format: number followed by unit (s, m, h, d). Examples: '15m', '1h', '30s', '1d'`
    );
  }

  const value = parseFloat(match[1] as string);
  const unit = match[2] as string;

  if (value <= 0) {
    throw new Error(`Window value must be positive, got: ${value}`);
  }

  if (!Number.isFinite(value)) {
    throw new Error(`Window value must be a finite number, got: ${value}`);
  }

  const multiplier = TIME_UNITS[unit];
  if (multiplier === undefined) {
    throw new Error(`Unknown time unit: ${unit}`);
  }

  const result = Math.floor(value * multiplier);

  if (result <= 0) {
    throw new Error(`Resulting window duration must be at least 1ms, got: ${result}ms`);
  }

  return result;
}

/**
 * Format milliseconds as a human-readable duration string.
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable string (e.g., '15m', '1h 30m', '2d')
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}
