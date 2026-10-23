import { describe, it, expect } from 'vitest';
import { detectClientOS } from '../src/utils/osDetector';

describe('detectClientOS', () => {
  it('correctly identifies Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const info = detectClientOS(ua);
    expect(info.os).toBe('windows');
    expect(info.recommendedFormat).toBe('.exe');
    expect(info.label).toBe('Windows');
    expect(info.assetExt).toBe('.exe');
  });

  it('correctly identifies macOS Intel (x64)', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    const info = detectClientOS(ua);
    expect(info.os).toBe('mac');
    expect(info.arch).toBe('x64');
    expect(info.label).toBe('macOS');
    expect(info.recommendedFormat).toBe('.dmg');
    expect(info.assetExt).toBe('.dmg');
  });

  it('correctly identifies macOS Apple Silicon (arm64)', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X) AppleWebKit/605.1.15';
    const info = detectClientOS(ua);
    expect(info.os).toBe('mac');
    expect(info.arch).toBe('arm64');
    expect(info.label).toBe('macOS (Apple Silicon)');
    expect(info.recommendedFormat).toBe('.dmg');
  });

  it('correctly identifies Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
    const info = detectClientOS(ua);
    expect(info.os).toBe('linux');
    expect(info.recommendedFormat).toBe('.AppImage');
    expect(info.label).toBe('Linux');
    expect(info.assetExt).toBe('.AppImage');
  });

  it('returns fallback for unknown or empty user agent', () => {
    const info = detectClientOS('');
    expect(info.os).toBe('unknown');
    expect(info.label).toBe('多平台通用');
    expect(info.recommendedFormat).toBe('Release');
  });
});
