import { parseWindow, formatDuration } from '../src/utils/parse-window';

describe('parseWindow', () => {
  describe('valid inputs', () => {
    it('should parse seconds', () => {
      expect(parseWindow('30s')).toBe(30000);
      expect(parseWindow('1s')).toBe(1000);
      expect(parseWindow('120s')).toBe(120000);
    });

    it('should parse minutes', () => {
      expect(parseWindow('1m')).toBe(60000);
      expect(parseWindow('15m')).toBe(900000);
      expect(parseWindow('30m')).toBe(1800000);
    });

    it('should parse hours', () => {
      expect(parseWindow('1h')).toBe(3600000);
      expect(parseWindow('2h')).toBe(7200000);
      expect(parseWindow('24h')).toBe(86400000);
    });

    it('should parse days', () => {
      expect(parseWindow('1d')).toBe(86400000);
      expect(parseWindow('7d')).toBe(604800000);
    });

    it('should handle whitespace', () => {
      expect(parseWindow(' 15m ')).toBe(900000);
      expect(parseWindow('15 m')).toBe(900000);
    });

    it('should be case-insensitive', () => {
      expect(parseWindow('15M')).toBe(900000);
      expect(parseWindow('1H')).toBe(3600000);
      expect(parseWindow('1D')).toBe(86400000);
    });

    it('should handle decimal values', () => {
      expect(parseWindow('1.5h')).toBe(5400000);
      expect(parseWindow('0.5m')).toBe(30000);
    });
  });

  describe('invalid inputs', () => {
    it('should throw on empty string', () => {
      expect(() => parseWindow('')).toThrow('Window must be a non-empty string');
    });

    it('should throw on missing unit', () => {
      expect(() => parseWindow('15')).toThrow('Invalid window format');
    });

    it('should throw on missing number', () => {
      expect(() => parseWindow('m')).toThrow('Invalid window format');
    });

    it('should throw on invalid unit', () => {
      expect(() => parseWindow('15x')).toThrow('Invalid window format');
      expect(() => parseWindow('15ms')).toThrow('Invalid window format');
    });

    it('should throw on negative values', () => {
      expect(() => parseWindow('-15m')).toThrow('Invalid window format');
    });

    it('should throw on zero', () => {
      expect(() => parseWindow('0m')).toThrow('Window value must be positive');
    });

    it('should throw on non-string input', () => {
      expect(() => parseWindow(null as unknown as string)).toThrow(
        'Window must be a non-empty string'
      );
      expect(() => parseWindow(undefined as unknown as string)).toThrow(
        'Window must be a non-empty string'
      );
      expect(() => parseWindow(123 as unknown as string)).toThrow(
        'Window must be a non-empty string'
      );
    });
  });
});

describe('formatDuration', () => {
  it('should format milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(30000)).toBe('30s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('should format minutes', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(900000)).toBe('15m');
    expect(formatDuration(90000)).toBe('1m 30s');
  });

  it('should format hours', () => {
    expect(formatDuration(3600000)).toBe('1h');
    expect(formatDuration(5400000)).toBe('1h 30m');
  });

  it('should format days', () => {
    expect(formatDuration(86400000)).toBe('1d');
    expect(formatDuration(129600000)).toBe('1d 12h');
  });
});
