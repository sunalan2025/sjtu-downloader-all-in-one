import baseCss from './jaccount-embed.css?raw'

/**
 * 统一样式与主题注入：
 * 1. 强制采用 Flexbox 双栏横向排布：左侧扫码登录 + 纵向分割线 + 右侧账密/短信登录；
 * 2. 破除 jAccount 响应式媒体查询中的折行与隐藏，保证二维码和表单始终水平并列；
 * 3. 彻底清除外层多余背景（如灰底 #dce3e6）、页眉、页脚及浮动条，实现与客户端窗口主题完美无缝融合；
 * 4. 深度契合客户端深浅色主题，动态注入色彩变量与精致圆角微阴影；
 * 5. 锁定 overflow: hidden，杜绝页面滚动条与局部溢出。
 */
export function getJAccountEmbedCss(isDark: boolean): string {
  const vars = isDark
    ? `
      --theme-bg: #161618;
      --theme-text: #F4F4F5;
      --theme-text-sub: #A1A1AA;
      --theme-text-muted: #71717A;
      --theme-border: rgba(255, 255, 255, 0.08);
      --theme-qr-bg: #FFFFFF;
      --theme-qr-border: rgba(255, 255, 255, 0.12);
      --theme-input-bg: #232326;
      --theme-input-border: rgba(255, 255, 255, 0.10);
      --theme-input-text: #F4F4F5;
      --theme-placeholder: #71717A;
      --theme-accent: #0A84FF;
      --theme-accent-hover: #409CFF;
      --theme-accent-ring: rgba(10, 132, 255, 0.25);
      --theme-accent-shadow: rgba(10, 132, 255, 0.2);
      --theme-warn-bg: #2E2316;
      --theme-warn-text: #FF9F0A;
    `
    : `
      --theme-bg: #FFFFFF;
      --theme-text: #1D1D1F;
      --theme-text-sub: #6E6E73;
      --theme-text-muted: #86868B;
      --theme-border: rgba(60, 60, 67, 0.12);
      --theme-qr-bg: #FFFFFF;
      --theme-qr-border: rgba(60, 60, 67, 0.16);
      --theme-input-bg: #F5F5F7;
      --theme-input-border: rgba(60, 60, 67, 0.12);
      --theme-input-text: #1D1D1F;
      --theme-placeholder: #AEAEB2;
      --theme-accent: #0071E3;
      --theme-accent-hover: #409CFF;
      --theme-accent-ring: rgba(0, 113, 227, 0.20);
      --theme-accent-shadow: rgba(0, 113, 227, 0.15);
      --theme-warn-bg: #FFF7E6;
      --theme-warn-text: #D46B08;
    `

  return `
    :root {
      ${vars}
    }

${baseCss}`
}
