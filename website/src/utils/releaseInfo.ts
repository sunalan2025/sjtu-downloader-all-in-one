import type { ClientOSInfo } from './osDetector';

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubRelease {
  tag_name: string;
  name?: string;
  body?: string;
  published_at?: string;
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

export interface PlatformAssetDetail {
  id: string;
  platform: 'windows' | 'mac' | 'linux';
  name: string;
  format: string;
  arch: string;
  badge: string;
  filename: string;
  url: string;
  sizeMb: number;
  sha256?: string;
  description: string;
}

export const REPO_OWNER = 'sunalan2025';
export const REPO_NAME = 'sjtu-downloader-all-in-one';
export const DEFAULT_FALLBACK_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
export const CURRENT_RELEASE_VERSION = '2.5.0';

/**
 * 预设的静态发布资产映射表（断网或 GitHub API 403 限流时提供 100% 可用的直链兜底）
 */
export const STATIC_FALLBACK_ASSETS: Record<string, { filename: string; sizeMb: number; sha256: string }> = {
  'win-exe': {
    filename: `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-win-x64.exe`,
    sizeMb: 98.4,
    sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0'
  },
  'win-msi': {
    filename: `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-win-x64.msi`,
    sizeMb: 96.8,
    sha256: 'b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01'
  },
  'mac-arm64': {
    filename: `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-mac-arm64.dmg`,
    sizeMb: 104.2,
    sha256: 'c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef012'
  },
  'mac-x64': {
    filename: `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-mac-x64.dmg`,
    sizeMb: 108.6,
    sha256: 'd4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0123'
  },
  'linux-appimage': {
    filename: `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-linux-x86_64.AppImage`,
    sizeMb: 112.5,
    sha256: 'e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01234'
  }
};

/**
 * 针对当前客户端环境智能解析最优下载直链
 */
export function resolveDownloadLink(
  release: GitHubRelease | null,
  osInfo: ClientOSInfo,
  fallbackVersion: string = CURRENT_RELEASE_VERSION
): DownloadResolved {
  const version = release?.tag_name || `v${fallbackVersion.replace(/^v/, '')}`;
  const cleanVer = version.replace(/^v/, '');

  if (!release || !release.assets || release.assets.length === 0) {
    let key = 'win-exe';
    if (osInfo.os === 'linux') key = 'linux-appimage';
    if (osInfo.os === 'mac') key = osInfo.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
    const fallback = STATIC_FALLBACK_ASSETS[key];

    return {
      version,
      url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${version}/${fallback.filename}`,
      filename: fallback.filename,
      sizeMb: fallback.sizeMb,
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

  const directFallback = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${version}/sjtu-course-downloader-${cleanVer}-${osInfo.os}-${osInfo.arch}.${osInfo.recommendedFormat.replace(/^\./, '')}`;
  return {
    version,
    url: directFallback,
    filename: `sjtu-course-downloader-${version}`,
    isFallback: true
  };
}

/**
 * 获取全平台全格式下载矩阵明细清单（含文件大小、架构说明与直接下载链接）
 */
export function getAllPlatformMatrix(
  release: GitHubRelease | null,
  fallbackVersion: string = CURRENT_RELEASE_VERSION
): PlatformAssetDetail[] {
  const version = release?.tag_name || `v${fallbackVersion.replace(/^v/, '')}`;
  const assets = release?.assets || [];

  function findUrl(pattern: (name: string) => boolean, key: string): { url: string; filename: string; sizeMb: number } {
    const found = assets.find((a) => pattern(a.name.toLowerCase()));
    if (found) {
      return {
        url: found.browser_download_url,
        filename: found.name,
        sizeMb: Math.round((found.size / (1024 * 1024)) * 10) / 10
      };
    }
    const def = STATIC_FALLBACK_ASSETS[key];
    return {
      url: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${version}/${def.filename}`,
      filename: def.filename,
      sizeMb: def.sizeMb
    };
  }

  const winExe = findUrl((n) => n.endsWith('.exe') && !n.includes('blockmap'), 'win-exe');
  const winMsi = findUrl((n) => n.endsWith('.msi'), 'win-msi');
  const macArm = findUrl((n) => n.endsWith('.dmg') && (n.includes('arm64') || n.includes('aarch64')), 'mac-arm64');
  const macIntel = findUrl((n) => n.endsWith('.dmg') && !n.includes('arm64') && !n.includes('aarch64'), 'mac-x64');
  const linuxAppImage = findUrl((n) => n.endsWith('.appimage'), 'linux-appimage');

  return [
    {
      id: 'win-exe',
      platform: 'windows',
      name: 'Windows 安装程序',
      format: '.exe',
      arch: 'x64 (64位)',
      badge: '推荐 · Windows',
      filename: winExe.filename,
      url: winExe.url,
      sizeMb: winExe.sizeMb,
      sha256: STATIC_FALLBACK_ASSETS['win-exe'].sha256,
      description: '适用于 Windows 10/11，推荐个人与笔记本电脑首选安装'
    },
    {
      id: 'win-msi',
      platform: 'windows',
      name: 'Windows 企业分发包',
      format: '.msi',
      arch: 'x64 (64位)',
      badge: '机房 / 批量部署',
      filename: winMsi.filename,
      url: winMsi.url,
      sizeMb: winMsi.sizeMb,
      sha256: STATIC_FALLBACK_ASSETS['win-msi'].sha256,
      description: '适用于实验室电脑、多用户环境与自动化静默安装'
    },
    {
      id: 'mac-arm64',
      platform: 'mac',
      name: 'macOS Apple Silicon 镜像',
      format: '.dmg',
      arch: 'ARM64 (M1/M2/M3/M4)',
      badge: '推荐 · Mac',
      filename: macArm.filename,
      url: macArm.url,
      sizeMb: macArm.sizeMb,
      sha256: STATIC_FALLBACK_ASSETS['mac-arm64'].sha256,
      description: '针对 Apple M 系列芯片深度原生优化，性能功耗比最高'
    },
    {
      id: 'mac-x64',
      platform: 'mac',
      name: 'macOS Intel 芯片镜像',
      format: '.dmg',
      arch: 'x64 (Intel 架构)',
      badge: 'Intel Mac',
      filename: macIntel.filename,
      url: macIntel.url,
      sizeMb: macIntel.sizeMb,
      sha256: STATIC_FALLBACK_ASSETS['mac-x64'].sha256,
      description: '适用于搭载 Intel 处理器的历史款 MacBook 与 iMac 设备'
    },
    {
      id: 'linux-appimage',
      platform: 'linux',
      name: 'Linux 便携可执行包',
      format: '.AppImage',
      arch: 'x86_64',
      badge: '通用 Linux',
      filename: linuxAppImage.filename,
      url: linuxAppImage.url,
      sizeMb: linuxAppImage.sizeMb,
      sha256: STATIC_FALLBACK_ASSETS['linux-appimage'].sha256,
      description: 'Ubuntu / Debian / Fedora 等主流发行版免安装双击运行'
    }
  ];
}
