import { describe, it, expect } from 'vitest';
import { resolveDownloadLink, type GitHubRelease } from '../src/utils/releaseInfo';
import { detectClientOS } from '../src/utils/osDetector';

describe('resolveDownloadLink', () => {
  const winOS = detectClientOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  const macIntelOS = detectClientOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15');
  const macArmOS = detectClientOS('Mozilla/5.0 (Macintosh; Apple Silicon Mac OS X)');
  const linuxOS = detectClientOS('Mozilla/5.0 (X11; Linux x86_64)');
  const unknownOS = detectClientOS('');

  it('resolves actual asset URL when release data is provided for Windows', () => {
    const mockRelease: GitHubRelease = {
      tag_name: 'v2.5.0',
      html_url: 'https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/tag/v2.5.0',
      assets: [
        {
          name: 'sjtu-course-downloader-2.5.0-win-x64.exe.blockmap',
          browser_download_url: 'https://github.com/releases/download/v2.5.0/sjtu-win.exe.blockmap',
          size: 1024
        },
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
    expect(resolved.filename).toBe('sjtu-course-downloader-2.5.0-win-x64.exe');
    expect(resolved.sizeMb).toBe(100);
    expect(resolved.isFallback).toBe(false);
  });

  it('resolves actual asset URL for macOS Apple Silicon (arm64)', () => {
    const mockRelease: GitHubRelease = {
      tag_name: 'v2.5.0',
      html_url: 'https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/tag/v2.5.0',
      assets: [
        {
          name: 'sjtu-course-downloader-2.5.0-mac-x64.dmg',
          browser_download_url: 'https://github.com/releases/download/v2.5.0/sjtu-mac-x64.dmg',
          size: 94371840
        },
        {
          name: 'sjtu-course-downloader-2.5.0-mac-arm64.dmg',
          browser_download_url: 'https://github.com/releases/download/v2.5.0/sjtu-mac-arm64.dmg',
          size: 94371840
        }
      ]
    };

    const resolved = resolveDownloadLink(mockRelease, macArmOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.url).toBe('https://github.com/releases/download/v2.5.0/sjtu-mac-arm64.dmg');
    expect(resolved.filename).toBe('sjtu-course-downloader-2.5.0-mac-arm64.dmg');
    expect(resolved.isFallback).toBe(false);
  });

  it('resolves actual asset URL for macOS Intel (x64)', () => {
    const mockRelease: GitHubRelease = {
      tag_name: 'v2.5.0',
      html_url: 'https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/tag/v2.5.0',
      assets: [
        {
          name: 'sjtu-course-downloader-2.5.0-mac-arm64.dmg',
          browser_download_url: 'https://github.com/releases/download/v2.5.0/sjtu-mac-arm64.dmg',
          size: 94371840
        },
        {
          name: 'sjtu-course-downloader-2.5.0-mac-x64.dmg',
          browser_download_url: 'https://github.com/releases/download/v2.5.0/sjtu-mac-x64.dmg',
          size: 94371840
        }
      ]
    };

    const resolved = resolveDownloadLink(mockRelease, macIntelOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.url).toBe('https://github.com/releases/download/v2.5.0/sjtu-mac-x64.dmg');
    expect(resolved.filename).toBe('sjtu-course-downloader-2.5.0-mac-x64.dmg');
    expect(resolved.isFallback).toBe(false);
  });

  it('resolves actual asset URL for Linux (.AppImage)', () => {
    const mockRelease: GitHubRelease = {
      tag_name: 'v2.5.0',
      html_url: 'https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/tag/v2.5.0',
      assets: [
        {
          name: 'sjtu-course-downloader-2.5.0-linux-x86_64.AppImage',
          browser_download_url: 'https://github.com/releases/download/v2.5.0/sjtu-linux.AppImage',
          size: 125829120
        }
      ]
    };

    const resolved = resolveDownloadLink(mockRelease, linuxOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.url).toBe('https://github.com/releases/download/v2.5.0/sjtu-linux.AppImage');
    expect(resolved.isFallback).toBe(false);
  });

  it('gracefully falls back to repo releases page if release is null', () => {
    const resolved = resolveDownloadLink(null, winOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.url).toContain('github.com/sunalan2025/sjtu-downloader-all-in-one/releases/latest');
    expect(resolved.isFallback).toBe(true);
  });

  it('gracefully falls back if assets array is empty', () => {
    const mockRelease: GitHubRelease = {
      tag_name: 'v2.5.0',
      html_url: 'https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/tag/v2.5.0',
      assets: []
    };

    const resolved = resolveDownloadLink(mockRelease, winOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.isFallback).toBe(true);
  });

  it('gracefully falls back to release html_url if no asset matches target OS', () => {
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

    const resolved = resolveDownloadLink(mockRelease, linuxOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.url).toBe('https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/tag/v2.5.0');
    expect(resolved.isFallback).toBe(true);
  });

  it('gracefully falls back for unknown OS to release html_url', () => {
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

    const resolved = resolveDownloadLink(mockRelease, unknownOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.url).toBe('https://github.com/sunalan2025/sjtu-downloader-all-in-one/releases/tag/v2.5.0');
    expect(resolved.isFallback).toBe(true);
  });
});
