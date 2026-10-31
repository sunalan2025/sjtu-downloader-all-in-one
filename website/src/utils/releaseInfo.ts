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

import releaseMetadata from '../data/release-metadata.json';

export const REPO_OWNER = 'sunalan2025';
export const REPO_NAME = 'sjtu-downloader-all-in-one';
export const DEFAULT_FALLBACK_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
export const CURRENT_RELEASE_VERSION = releaseMetadata?.version || '2.5.3';

/**
 * 预设的静态发布资产映射表（优先使用构建期自动抓取的 Release 元数据，离线时提供全套直链与哈希兜底）
 */
export const STATIC_FALLBACK_ASSETS: Record<string, { filename: string; sizeMb: number; sha256: string }> = {
  'win-exe': {
    filename: releaseMetadata?.assets?.['win-exe']?.filename || `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-win-x64.exe`,
    sizeMb: releaseMetadata?.assets?.['win-exe']?.sizeMb || 126.0,
    sha256: releaseMetadata?.assets?.['win-exe']?.sha256 || '38e7795d48872673a0868740847158bef4e3d5381c35cea2991f43dfc1a35d74'
  },
  'win-msi': {
    filename: releaseMetadata?.assets?.['win-msi']?.filename || `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-win-x64.msi`,
    sizeMb: releaseMetadata?.assets?.['win-msi']?.sizeMb || 133.4,
    sha256: releaseMetadata?.assets?.['win-msi']?.sha256 || '4351f561169aee7dabaa16665bdcc886b1d0944a80a2458788c7db619778beb4'
  },
  'mac-arm64': {
    filename: releaseMetadata?.assets?.['mac-arm64']?.filename || `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-mac-arm64.dmg`,
    sizeMb: releaseMetadata?.assets?.['mac-arm64']?.sizeMb || 135.9,
    sha256: releaseMetadata?.assets?.['mac-arm64']?.sha256 || '765ccd7fc3399a1edb9ea45537551fb7c7efb273a1a52e0a3331e68029334583'
  },
  'mac-x64': {
    filename: releaseMetadata?.assets?.['mac-x64']?.filename || `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-mac-arm64.zip`,
    sizeMb: releaseMetadata?.assets?.['mac-x64']?.sizeMb || 130.7,
    sha256: releaseMetadata?.assets?.['mac-x64']?.sha256 || '8de8ea7526c82d539c3dae7c677a217261db1add6ea7e410a8fef6e0ee6dfa89'
  },
  'linux-appimage': {
    filename: releaseMetadata?.assets?.['linux-appimage']?.filename || `sjtu-course-downloader-${CURRENT_RELEASE_VERSION}-linux-x86_64.AppImage`,
    sizeMb: releaseMetadata?.assets?.['linux-appimage']?.sizeMb || 147.6,
    sha256: releaseMetadata?.assets?.['linux-appimage']?.sha256 || '59c0c10141b917fb7c7028331cfab1d63bc5dd8d2b072ab165a4de2dbcd904f2'
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
      (a) =>
        a.name.toLowerCase().endsWith('.exe') &&
        !a.name.toLowerCase().includes('blockmap') &&
        !a.name.toLowerCase().includes('elevate') &&
        !a.name.toLowerCase().includes('ffmpeg')
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
 * 从 Release 的 body 描述文本中提取指定产物的 SHA256 哈希
 */
function extractSha256(release: GitHubRelease | null, filename: string): string | undefined {
  if (!release?.body) return undefined;
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 匹配标准 sha256sum 形式: "<hash>  filename" 或 "<hash> *filename"
  const linePattern = new RegExp(`([a-fA-F0-9]{64})\\s+[*]?${escaped}`, 'i');
  const lineMatch = release.body.match(linePattern);
  if (lineMatch) return lineMatch[1].toLowerCase();

  // 匹配形式: "filename: <hash>" 或 "filename - <hash>"
  const reversePattern = new RegExp(`${escaped}[:\\s-]+([a-fA-F0-9]{64})`, 'i');
  const reverseMatch = release.body.match(reversePattern);
  if (reverseMatch) return reverseMatch[1].toLowerCase();

  return undefined;
}

/**
 * 获取全平台全格式下载矩阵明细清单（含文件大小、架构说明与直接下载链接）
 */
export function getAllPlatformMatrix(
  release: GitHubRelease | null,
  fallbackVersion: string = CURRENT_RELEASE_VERSION
): PlatformAssetDetail[] {
  const version = release?.tag_name || `v${fallbackVersion.replace(/^v/, '')}`;
  const cleanVersion = version.replace(/^v/, '');
  const isCurrentVersion = !release || cleanVersion === CURRENT_RELEASE_VERSION;
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

  const winExe = findUrl(
    (n) => n.endsWith('.exe') && !n.includes('blockmap') && !n.includes('elevate') && !n.includes('ffmpeg'),
    'win-exe'
  );
  const winMsi = findUrl((n) => n.endsWith('.msi'), 'win-msi');
  const macArm = findUrl((n) => n.endsWith('.dmg') && (n.includes('arm64') || n.includes('aarch64')), 'mac-arm64');
  const macIntel = findUrl(
    (n) =>
      !n.includes('arm64') &&
      !n.includes('aarch64') &&
      ((n.endsWith('.dmg') && (n.includes('mac') || n.includes('darwin') || n.includes('x64'))) ||
       (n.endsWith('.zip') && (n.includes('mac') || n.includes('darwin') || n.includes('x64')))),
    'mac-x64'
  );
  const linuxAppImage = findUrl((n) => n.endsWith('.appimage'), 'linux-appimage');

  function resolveSha256(key: string, filename: string): string | undefined {
    if (isCurrentVersion) {
      return STATIC_FALLBACK_ASSETS[key]?.sha256;
    }
    return extractSha256(release, filename);
  }

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
      sha256: resolveSha256('win-exe', winExe.filename),
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
      sha256: resolveSha256('win-msi', winMsi.filename),
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
      sha256: resolveSha256('mac-arm64', macArm.filename),
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
      sha256: resolveSha256('mac-x64', macIntel.filename),
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
      sha256: resolveSha256('linux-appimage', linuxAppImage.filename),
      description: 'Ubuntu / Debian / Fedora 等主流发行版免安装双击运行'
    }
  ];
}
