import type { ClientOSInfo } from './osDetector';

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: GitHubAsset[];
}

export interface DownloadResolved {
  version: string;
  url: string;
  filename: string;
  sizeMb?: number;
  isFallback: boolean;
}

export const REPO_OWNER = 'sunalan2025';
export const REPO_NAME = 'sjtu-downloader-all-in-one';
export const DEFAULT_FALLBACK_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

export function resolveDownloadLink(
  release: GitHubRelease | null,
  osInfo: ClientOSInfo,
  fallbackVersion: string = '2.5.0'
): DownloadResolved {
  const version = release?.tag_name || `v${fallbackVersion.replace(/^v/, '')}`;

  if (!release || !release.assets || release.assets.length === 0) {
    return {
      version,
      url: DEFAULT_FALLBACK_URL,
      filename: `sjtu-course-downloader-${fallbackVersion}`,
      isFallback: true
    };
  }

  let targetAsset: GitHubAsset | undefined;

  if (osInfo.os === 'windows') {
    targetAsset = release.assets.find(
      (a) => a.name.toLowerCase().endsWith('.exe') && !a.name.toLowerCase().includes('blockmap')
    );
  } else if (osInfo.os === 'linux') {
    targetAsset = release.assets.find((a) => a.name.toLowerCase().endsWith('.appimage'));
  } else if (osInfo.os === 'mac') {
    const dmgAssets = release.assets.filter((a) => a.name.toLowerCase().endsWith('.dmg'));
    if (osInfo.arch === 'arm64') {
      targetAsset =
        dmgAssets.find(
          (a) => a.name.toLowerCase().includes('arm64') || a.name.toLowerCase().includes('aarch64')
        ) || dmgAssets[0];
    } else {
      targetAsset =
        dmgAssets.find(
          (a) => !a.name.toLowerCase().includes('arm64') && !a.name.toLowerCase().includes('aarch64')
        ) || dmgAssets[0];
    }
  }

  if (targetAsset) {
    return {
      version,
      url: targetAsset.browser_download_url,
      filename: targetAsset.name,
      sizeMb: Math.round((targetAsset.size / (1024 * 1024)) * 10) / 10,
      isFallback: false
    };
  }

  return {
    version,
    url: release.html_url || DEFAULT_FALLBACK_URL,
    filename: `sjtu-course-downloader-${version}`,
    isFallback: true
  };
}
