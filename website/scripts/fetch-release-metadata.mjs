import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_OWNER = 'sunalan2025';
const REPO_NAME = 'sjtu-downloader-all-in-one';
const TARGET_PATH = path.resolve(__dirname, '../src/data/release-metadata.json');

async function main() {
  console.log('[website:sync] 正在尝试从 GitHub API 同步最新 Release 信息与 SHA-256...');

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'sjtu-downloader-website-sync'
  };
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, {
      headers
    });

    if (!res.ok) {
      console.warn(`[website:sync] 获取 GitHub Release 失败 (HTTP ${res.status})，保持现有静态元数据`);
      return;
    }

    const release = await res.json();
    const version = (release.tag_name || '').replace(/^v/, '');
    if (!version) {
      console.warn('[website:sync] 未获取到有效的 Release tag_name，保持现有静态元数据');
      return;
    }

    console.log(`[website:sync] 成功获取最新版本: v${version}`);

    const checksumAsset = release.assets?.find((a) => a.name.toLowerCase() === 'sha256sums.txt');
    const checksums = {};

    if (checksumAsset?.browser_download_url) {
      try {
        const sumRes = await fetch(checksumAsset.browser_download_url);
        if (sumRes.ok) {
          const sumText = await sumRes.text();
          const lines = sumText.split(/\r?\n/);
          for (const line of lines) {
            const match = line.trim().match(/^([a-fA-F0-9]{64})\s+[*]?(.+)$/);
            if (match) {
              const hash = match[1].toLowerCase();
              const filename = match[2].trim();
              checksums[filename] = hash;
            }
          }
          console.log(`[website:sync] 成功解析 SHA256SUMS.txt (${Object.keys(checksums).length} 项)`);
        }
      } catch (err) {
        console.warn('[website:sync] 下载 SHA256SUMS.txt 失败:', err.message);
      }
    }

    const assets = {};
    const keyPatterns = [
      { key: 'win-exe', test: (n) => n.endsWith('.exe') && !n.includes('blockmap') && !n.includes('elevate') && !n.includes('ffmpeg') },
      { key: 'win-msi', test: (n) => n.endsWith('.msi') },
      { key: 'mac-arm64', test: (n) => n.endsWith('.dmg') && (n.includes('arm64') || n.includes('aarch64')) },
      { key: 'mac-x64', test: (n) => n.endsWith('.zip') && (n.includes('mac') || n.includes('darwin') || n.includes('x64')) },
      { key: 'linux-appimage', test: (n) => n.endsWith('.appimage') }
    ];

    for (const { key, test } of keyPatterns) {
      const found = release.assets?.find((a) => test(a.name.toLowerCase()));
      if (found) {
        const sizeMb = Math.round((found.size / (1024 * 1024)) * 10) / 10;
        const sha256 = checksums[found.name] || '';
        assets[key] = {
          filename: found.name,
          sizeMb,
          sha256,
          url: found.browser_download_url
        };
      }
    }

    const metadata = {
      version,
      tagName: release.tag_name,
      publishedAt: release.published_at || new Date().toISOString(),
      checksums,
      assets
    };

    fs.mkdirSync(path.dirname(TARGET_PATH), { recursive: true });
    fs.writeFileSync(TARGET_PATH, JSON.stringify(metadata, null, 2), 'utf-8');
    console.log(`[website:sync] 成功更新元数据文件: ${TARGET_PATH}`);
  } catch (err) {
    console.warn('[website:sync] 同步过程发生异常，优雅降级保持现有数据:', err.message);
  }
}

main();
