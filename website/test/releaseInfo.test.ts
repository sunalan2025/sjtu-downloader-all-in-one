import { describe, it, expect } from 'vitest';
import { resolveDownloadLink, getAllPlatformMatrix, type GitHubRelease } from '../src/utils/releaseInfo';
import { detectClientOS } from '../src/utils/osDetector';

describe('resolveDownloadLink', () => {
  const winOS = detectClientOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  const macArmOS = detectClientOS('Mozilla/5.0 (Macintosh; Apple Silicon) AppleWebKit/605.1.15');

  it('resolves actual asset URL when release data is provided', () => {
    const mockRelease: GitHubRelease = {
      tag_name: 'v2.5.0',
      html_url: 'https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/tag/v2.5.0',
      assets: [
        {
          name: 'sjtu-course-downloader-2.5.0-win-x64.exe',
          browser_download_url: 'https://github.com/releases/download/v2.5.0/sjtu-win.exe',
          size: 104857600
        }
      ]
    };

    const resolved = resolveDownloadLink(mockRelease, winOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.url).toBe('https://github.com/releases/download/v2.5.0/sjtu-win.exe');
    expect(resolved.isFallback).toBe(false);
  });

  it('provides precise direct download fallback when release is null', () => {
    const resolved = resolveDownloadLink(null, winOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.url).toContain('releases/download/v2.5.0/sjtu-course-downloader-2.5.0-win-x64.exe');
    expect(resolved.isFallback).toBe(true);

    const macResolved = resolveDownloadLink(null, macArmOS, '2.5.0');
    expect(macResolved.url).toContain('.dmg');
    expect(macResolved.isFallback).toBe(true);
  });
});

describe('getAllPlatformMatrix', () => {
  it('returns complete 5 platform packages with SHA256 and descriptions', () => {
    const matrix = getAllPlatformMatrix(null, '2.5.0');
    expect(matrix).toHaveLength(5);

    const winExe = matrix.find((p) => p.id === 'win-exe');
    expect(winExe).toBeDefined();
    expect(winExe?.format).toBe('.exe');
    expect(winExe?.sha256).toBeDefined();
    expect(winExe?.url).toContain('.exe');

    const macArm = matrix.find((p) => p.id === 'mac-arm64');
    expect(macArm).toBeDefined();
    expect(macArm?.arch).toContain('ARM64');
  });
});
