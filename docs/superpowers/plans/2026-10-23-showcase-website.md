# 上海交通大学课程下载器 官方介绍网站实施计划 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为上海交通大学课程下载器打造现代化、高视觉质感、深浅色自适应且具备智能操作系统探测下载的官方介绍网站（存放在 `website/` 目录），并配置 GitHub Actions 自动构建部署至独立子域名 `sjtu.hisunalan.me`（基于 GitHub Pages）。

**Architecture:** 
1. 作为独立子工程在主仓库建立 `website/` 目录，采用 Astro 5.x 纯静态生成（SSG）与 Tailwind CSS 3.4 原子化样式，零运行时 JS 开销，首屏秒开且不污染主客户端 Electron 依赖；
2. 封装系统识别与版本数据层（`osDetector.ts` 与 `releaseInfo.ts`），前端自动识别访问者操作系统（Windows、macOS Apple Silicon / Intel、Linux）并高亮最优安装包，并建立 GitHub API 实时版本与静态构建期基准数据的双轨降级兜底保障；
3. 配置 `.github/workflows/website-deploy.yml`，在 `website/**` 发生变动或发布新 Release 时自动构建并将 `website/dist` 部署至 GitHub Pages，无缝应用 `sjtu.hisunalan.me` 域名并自动开启 HTTPS。

**Tech Stack:** Astro 5.x, Tailwind CSS 3.4, TypeScript, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-23-showcase-website-design.md](file:///d:/SJTU/%E7%BC%96%E7%A8%8B/sjtu-downloader-all-in-one/docs/superpowers/specs/2026-10-23-showcase-website-design.md)

## Global Constraints

- **完全解耦**：`website/` 必须作为完全独立的子工程，拥有自己的 `package.json`，严禁向根目录 `package.json` 引入任何 Web 依赖，严禁污染 Electron 客户端环境。
- **文案规范铁律**：对外展示文案必须严格遵循《拟修改词汇与规范化对照表》，严禁使用“分块切片”、“抓取”、“爬取”等工程黑话，统一使用“PPT 课件导出为单份 PDF 讲义”、“同步已选旁听课程”、“后台自动续传下载”、“本地与交大云盘双备份”。
- **双模自适应**：必须原生支持深浅色无缝自适应切换，默认根据系统偏好初始化，防止首屏出现闪烁。
- **零白屏与降级兜底**：前端拉取 GitHub Releases API 时必须包含可靠的 try/catch 降级逻辑，在 API 限流（HTTP 403）或无网络时平滑静默回退到构建期预设版本号与官方 Release 页面通用直链。
- **全链路门禁**：
  - `cd website && npm run check` 静态检查 0 错误；
  - `cd website && npm run test` 单元测试 100% 通过；
  - `cd website && npm run build` 静态打包 0 错误 0 警告；
  - 根目录下 `npm run typecheck`、`npm run lint` 与 `npm test` 保持 100% 全绿。

---

### Task 1: 初始化 `website/` 独立工程架构与基础依赖配置

**Files:**
- Create: `website/package.json`
- Create: `website/astro.config.mjs`
- Create: `website/tailwind.config.mjs`
- Create: `website/tsconfig.json`
- Create: `website/public/CNAME`
- Create: `website/src/styles/global.css`

**Interfaces:**
- Consumes: None
- Produces: 
  - `website/package.json` 提供 `dev`, `build`, `check`, `test` 脚本
  - `website/public/CNAME` 包含 `sjtu.hisunalan.me`

- [ ] **Step 1: 编写 `website/package.json`、`astro.config.mjs`、`tailwind.config.mjs`、`tsconfig.json` 与 `CNAME`**

编写 `website/package.json`：
```json
{
  "name": "sjtu-downloader-website",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check",
    "test": "vitest run"
  },
  "dependencies": {
    "@astrojs/check": "^0.9.4",
    "@astrojs/tailwind": "^5.1.5",
    "astro": "^5.3.0",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2"
  },
  "devDependencies": {
    "vitest": "^3.0.5"
  }
}
```

编写 `website/astro.config.mjs`：
```javascript
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://sjtu.hisunalan.me',
  integrations: [tailwind({ applyBaseStyles: false })]
});
```

编写 `website/tailwind.config.mjs`：
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sjtu: {
          navy: '#004098',
          blue: '#165DFF',
          dark: '#070B14',
          night: '#0D1527',
          cyan: '#00D2D3'
        }
      }
    }
  },
  plugins: []
};
```

编写 `website/tsconfig.json`：
```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "strictNullChecks": true,
    "allowJs": true
  }
}
```

编写 `website/public/CNAME`：
```text
sjtu.hisunalan.me
```

编写 `website/src/styles/global.css`：
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    scroll-behavior: smooth;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
}
```

- [ ] **Step 2: 在 `website` 目录下安装依赖**

执行命令：
```powershell
cd website; npm install
```

- [ ] **Step 3: 运行 `npm run check` 验证脚手架配置无误**

执行命令：
```powershell
cd website; npm run check
```
预期输出：`0 errors, 0 warnings`

- [ ] **Step 4: Git 提交初始化配置**

```powershell
git add website/
git commit -m "chore(website): scaffold astro website project with tailwind and custom domain cname"
```

---

### Task 2: 客户端操作系统探测器与 Release 版本管理工具及其单元测试

**Files:**
- Create: `website/src/utils/osDetector.ts`
- Create: `website/src/utils/releaseInfo.ts`
- Create: `website/test/osDetector.test.ts`
- Create: `website/test/releaseInfo.test.ts`

**Interfaces:**
- Consumes: None
- Produces: 
  - `detectClientOS(userAgent: string): ClientOSInfo`
  - `type ClientOSInfo = { os: 'windows' | 'mac' | 'linux' | 'unknown', arch: 'arm64' | 'x64', label: string, recommendedFormat: string, assetExt: string }`
  - `resolveDownloadLink(release: GitHubRelease | null, osInfo: ClientOSInfo, fallbackVersion: string): DownloadResolved`

- [ ] **Step 1: 编写失败单元测试 `website/test/osDetector.test.ts` 与 `website/test/releaseInfo.test.ts`**

编写 `website/test/osDetector.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { detectClientOS } from '../src/utils/osDetector';

describe('detectClientOS', () => {
  it('correctly identifies Windows', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    const info = detectClientOS(ua);
    expect(info.os).toBe('windows');
    expect(info.recommendedFormat).toBe('.exe');
    expect(info.label).toBe('Windows');
  });

  it('correctly identifies macOS Apple Silicon (arm64)', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    // Mac UA typically contains Macintosh
    const info = detectClientOS(ua);
    expect(info.os).toBe('mac');
    expect(info.recommendedFormat).toBe('.dmg');
  });

  it('correctly identifies Linux', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
    const info = detectClientOS(ua);
    expect(info.os).toBe('linux');
    expect(info.recommendedFormat).toBe('.AppImage');
    expect(info.label).toBe('Linux');
  });
});
```

编写 `website/test/releaseInfo.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { resolveDownloadLink, type GitHubRelease } from '../src/utils/releaseInfo';
import { detectClientOS } from '../src/utils/osDetector';

describe('resolveDownloadLink', () => {
  const winOS = detectClientOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

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

  it('gracefully falls back to repo releases page if release or asset is missing', () => {
    const resolved = resolveDownloadLink(null, winOS, '2.5.0');
    expect(resolved.version).toBe('v2.5.0');
    expect(resolved.url).toContain('github.com/sunalan2025/sjtu-downloader-all-in-one/releases/latest');
    expect(resolved.isFallback).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

执行命令：
```powershell
cd website; npm run test
```
预期输出：FAIL（模块尚未实现）

- [ ] **Step 3: 编写 `osDetector.ts` 与 `releaseInfo.ts` 实现**

编写 `website/src/utils/osDetector.ts`：
```typescript
export interface ClientOSInfo {
  os: 'windows' | 'mac' | 'linux' | 'unknown';
  arch: 'arm64' | 'x64';
  label: string;
  recommendedFormat: string;
  assetExt: string;
}

export function detectClientOS(userAgent: string = ''): ClientOSInfo {
  const ua = userAgent.toLowerCase();

  if (ua.includes('win')) {
    return {
      os: 'windows',
      arch: 'x64',
      label: 'Windows',
      recommendedFormat: '.exe',
      assetExt: '.exe'
    };
  }

  if (ua.includes('mac') || ua.includes('darwin')) {
    const isArm = ua.includes('arm') || ua.includes('apple');
    return {
      os: 'mac',
      arch: isArm ? 'arm64' : 'x64',
      label: isArm ? 'macOS (Apple Silicon)' : 'macOS',
      recommendedFormat: '.dmg',
      assetExt: '.dmg'
    };
  }

  if (ua.includes('linux') || ua.includes('x11')) {
    return {
      os: 'linux',
      arch: 'x64',
      label: 'Linux',
      recommendedFormat: '.AppImage',
      assetExt: '.AppImage'
    };
  }

  return {
    os: 'unknown',
    arch: 'x64',
    label: '多平台通用',
    recommendedFormat: 'Release',
    assetExt: ''
  };
}
```

编写 `website/src/utils/releaseInfo.ts`：
```typescript
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

  const targetAsset = release.assets.find((asset) => {
    const name = asset.name.toLowerCase();
    if (osInfo.os === 'windows') {
      return name.endsWith('.exe') && !name.includes('blockmap');
    }
    if (osInfo.os === 'mac') {
      if (osInfo.arch === 'arm64' && name.includes('arm64') && name.endsWith('.dmg')) {
        return true;
      }
      return name.endsWith('.dmg');
    }
    if (osInfo.os === 'linux') {
      return name.endsWith('.appimage');
    }
    return false;
  });

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
```

- [ ] **Step 4: 运行单元测试验证全绿**

执行命令：
```powershell
cd website; npm run test
```
预期输出：`2 passed (100%)`

- [ ] **Step 5: Git 提交**

```powershell
git add website/src/utils/ website/test/
git commit -m "feat(website): add client OS detector and GitHub release fallback resolver with tests"
```

---

### Task 3: 构建视觉基座、全套矢量图标与基础 Layout / Navbar 导航

**Files:**
- Create: `website/src/components/icons/Icons.astro`
- Create: `website/src/layouts/Layout.astro`
- Create: `website/src/components/Navbar.astro`

**Interfaces:**
- Consumes: `Icons.astro` 提供多种图标渲染
- Produces: 
  - `Layout.astro`（接收 `title`, `description`，提供深浅色无闪烁切换脚本）
  - `Navbar.astro`（集成 Logo、锚点跳转、深浅色模式切换、GitHub Star 徽章）

- [ ] **Step 1: 编写 `website/src/components/icons/Icons.astro`**

实现包含 Windows, Apple, Linux, Download, Shield, Sparkles, Sun, Moon, ChevronDown, Check, Cloud, BookOpen, Video, GraduationCap, Github 等内联矢量 SVG 图标组件，保证零第三方图标库版本漂移与外部依赖。

- [ ] **Step 2: 编写 `website/src/layouts/Layout.astro`**

包含：
- HTML 骨架、标准 `<head>`，包含交大蓝主题色声明 `<meta name="theme-color" content="#004098">`；
- OpenGraph 与 Twitter Card 社交分享元标签；
- **防闪烁深浅色初始化内联脚本**：在 DOM 加载首帧读取 `localStorage.theme` 或 `window.matchMedia('(prefers-color-scheme: dark)')` 并向 `<html>` 添加 `dark` 类；
- 放置插槽 `<slot />`。

- [ ] **Step 3: 编写 `website/src/components/Navbar.astro`**

包含：
- 顶部固定毛玻璃效果（`sticky top-0 z-50 backdrop-blur-md bg-white/80 dark:bg-sjtu-dark/80 border-b border-black/[0.06] dark:border-white/[0.08]`）；
- 左侧：交大专属校徽盾牌形状与“上海交通大学课程下载器”文字标牌；
- 中部：特性（`#features`）、安全背书（`#security`）、下载矩阵（`#download`）、常见问题（`#faq`）锚点导航；
- 右侧：
  - 深浅色切换按钮（自带客户端切换逻辑并写入 localStorage）；
  - GitHub 仓库徽标与 Stars 外链；
  - “立即下载”快速按钮。

- [ ] **Step 4: 运行 `npm run check` 验证无类型与语法错误**

```powershell
cd website; npm run check
```

- [ ] **Step 5: Git 提交**

```powershell
git add website/src/components/icons/ website/src/layouts/ website/src/components/Navbar.astro
git commit -m "feat(website): implement Layout, semantic vector Icons, and responsive Navbar with theme switcher"
```

---

### Task 4: 实现 Hero 聚焦区、智能下载按钮与客户端界面展示悬浮卡片

**Files:**
- Create: `website/src/components/SmartDownload.astro`
- Create: `website/src/components/AppPreview.astro`
- Create: `website/src/components/Hero.astro`

**Interfaces:**
- Consumes: `detectClientOS`, `resolveDownloadLink`, `Icons.astro`
- Produces: 
  - `SmartDownload.astro` 客户端自适应下载入口
  - `AppPreview.astro` 客户端界面高精度悬浮展示
  - `Hero.astro` 首屏组合区域

- [ ] **Step 1: 编写 `website/src/components/SmartDownload.astro`**

实现：
- 静态预渲染默认 Windows 版下载按钮作为基准 fallback；
- 嵌入轻量客户端 `<script>` 岛屿：
  - 自动调用 `detectClientOS(navigator.userAgent)` 动态更新主下载按钮的文案与平台徽标（如识别为 Mac 则呈现苹果图标与 `.dmg`，识别为 Linux 呈现对应图标）；
  - 静默异步调用 GitHub API（`https://api.github.com/repos/sunalan2025/sjtu-downloader-all-in-one/releases/latest`），成功时自动更新版本标签与文件大小；若失败/限流则保持静态基准无感降级；
  - 提供“所有平台”下拉展开功能，提供 Windows (`.exe` / `.msi`)、macOS (`Apple Silicon` / `Intel`)、Linux (`.AppImage`) 快速直达。

- [ ] **Step 2: 编写 `website/src/components/AppPreview.astro`**

实现：
- 现代 macOS 窗口外观（带红黄绿交通灯、半透明顶栏与精致阴影）；
- 展示下载器在多级分栏与网格卡片下的优雅界面；
- 动态呼吸微光（Glow Effect）与悬浮视差立体投影，呈现高端桌面客户端质感。

- [ ] **Step 3: 编写 `website/src/components/Hero.astro`**

实现：
- 醒目大标语：“专为上海交通大学师生打造的课程资源与知识归档工具”；
- 权威副标题：“一站式批量下载与备份 Canvas 课件录播、旁听课程视频、好大学在线，深度集成交大云盘双向存储”；
- 整合 `SmartDownload.astro` 与 `AppPreview.astro`。

- [ ] **Step 4: 运行 `npm run check` 验证通过**

```powershell
cd website; npm run check
```

- [ ] **Step 5: Git 提交**

```powershell
git add website/src/components/SmartDownload.astro website/src/components/AppPreview.astro website/src/components/Hero.astro
git commit -m "feat(website): build Hero section with smart OS detection download button and app preview"
```

---

### Task 5: 实现四大特性矩阵、安全原理背书、下载表格与交互式 FAQ

**Files:**
- Create: `website/src/components/FeatureMatrix.astro`
- Create: `website/src/components/SecuritySpec.astro`
- Create: `website/src/components/DownloadTable.astro`
- Create: `website/src/components/FaqSection.astro`
- Create: `website/src/components/Footer.astro`

**Interfaces:**
- Consumes: 规范化词汇与文本、`Icons.astro`
- Produces: 落地页主体内容区域

- [ ] **Step 1: 编写 `website/src/components/FeatureMatrix.astro`**

严格遵循《拟修改词汇与规范化对照表》，实现 2x2 响应式特性卡片：
1. 📚 **Canvas 教学全量提取**：原始课件树状层级保留、模块补漏文件归集、双路录播超清流、**PPT 课件导出为单份 PDF 讲义**；
2. 🎬 **旁听课程视频规整**：**同步已选旁听课程**、纠偏教务系统课次乱序、按真实开课日期归整排序；
3. 🎓 **好大学在线 (CNMOOC)**：章节树状层级下钻、智能过滤无下载实体的练习测验；
4. ☁️ **交大云盘深度集成**：**本地与交大云盘双备份**、免网页端登录直接管理、存储空间实时监控。

- [ ] **Step 2: 编写 `website/src/components/SecuritySpec.astro`**

展示三大安全与工程硬实力：
1. 操作系统硬件保险库（Windows DPAPI / macOS Keychain），磁盘零明文；
2. 安全防误操作：自动填充仅填入输入框，**绝不自动提交表单**；
3. 动态多线程并发调度与智能跳过已有同名文件。

- [ ] **Step 3: 编写 `website/src/components/DownloadTable.astro`**

展示：
- Windows、macOS (Apple Silicon / Intel)、Linux 全量包格式与适用场景；
- **校园网络环境与 VPN 准入核心提示**（校外须使用 EasyConnect VPN）；
- **Windows SmartScreen 提示应对指南**（「更多信息」→「仍要运行」）；
- 内置 FFmpeg 说明。

- [ ] **Step 4: 编写 `website/src/components/FaqSection.astro` 与 `website/src/components/Footer.astro`**

- `FaqSection.astro`：实现原生流畅的手风琴切换动画，覆盖校外下载限制、文件存储路径、云盘配额与双向备份模式、后台自动续传下载保活策略；
- `Footer.astro`：呈现开源 MIT 许可声明、GitHub Issues 建议入口、交大开源社区生态致敬及免责声明。

- [ ] **Step 5: 运行 `npm run check` 验证通过**

```powershell
cd website; npm run check
```

- [ ] **Step 6: Git 提交**

```powershell
git add website/src/components/FeatureMatrix.astro website/src/components/SecuritySpec.astro website/src/components/DownloadTable.astro website/src/components/FaqSection.astro website/src/components/Footer.astro
git commit -m "feat(website): add feature matrix, security spec, download table, faq accordion, and footer"
```

---

### Task 6: 整合落地页主入口、生成矢量 Favicon 与全站静态编译验证

**Files:**
- Create: `website/src/pages/index.astro`
- Create: `website/public/favicon.svg`
- Create: `website/public/og-image.svg`

**Interfaces:**
- Consumes: All components from Task 3, 4, 5
- Produces: 
  - `website/dist/` 纯静态生产构建产物

- [ ] **Step 1: 编写 `website/src/pages/index.astro` 页面聚合入口**

整合 `Layout`, `Navbar`, `Hero`, `FeatureMatrix`, `SecuritySpec`, `DownloadTable`, `FaqSection`, `Footer`。

- [ ] **Step 2: 创建专属品牌矢量图标 `favicon.svg` 与 `og-image.svg`**

在 `website/public/` 中创建交大深蓝为主色、融合下载与知识盾牌意象的矢量 SVG 图标与社交卡片。

- [ ] **Step 3: 执行全站静态编译与检查**

执行命令：
```powershell
cd website; npm run check; npm run build
```
预期输出：
- `check`：0 errors, 0 warnings
- `build`：成功输出完整的 HTML、CSS、JS 与资源文件至 `website/dist/`，且 `website/dist/CNAME` 存在并内容为 `sjtu.hisunalan.me`。

- [ ] **Step 4: Git 提交**

```powershell
git add website/src/pages/index.astro website/public/
git commit -m "feat(website): assemble landing page and build static output with branded assets"
```

---

### Task 7: 建立 GitHub Actions 自动部署流水线与全项目回归门禁验证

**Files:**
- Create: `.github/workflows/website-deploy.yml`
- Modify: `README.md:1-10`

**Interfaces:**
- Consumes: `website/**` 静态构建
- Produces: 
  - 自动部署至 GitHub Pages 环境与 `sjtu.hisunalan.me` 域名

- [ ] **Step 1: 编写 `.github/workflows/website-deploy.yml` 自动部署工作流**

配置仅在 `website/**` 或 workflow 本身变动、或新 Release 发布时触发，使用 Node.js 22、缓存依赖，构建并发布 Pages 产物。

- [ ] **Step 2: 在主项目 `README.md` 顶栏增加官网访问徽章**

在 `README.md` 顶栏徽标行补充：
```markdown
[![Website](https://img.shields.io/badge/官网-sjtu.hisunalan.me-004098?style=flat&logo=safari)](https://sjtu.hisunalan.me)
```

- [ ] **Step 3: 运行主项目全套回归测试门禁**

在工程根目录下执行门禁三部曲：
```powershell
npm run typecheck
npm run lint
npm test
```
预期结果：所有命令 100% 退出码为 0，0 错误 0 警告，测试用例全部通过。

- [ ] **Step 4: Git 提交**

```powershell
git add .github/workflows/website-deploy.yml README.md
git commit -m "ci: add GitHub Actions workflow for automatic showcase website deployment to sjtu.hisunalan.me"
```
