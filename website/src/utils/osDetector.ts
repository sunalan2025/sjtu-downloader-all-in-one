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
    const isArm =
      ua.includes('arm64') ||
      ua.includes('aarch64') ||
      ua.includes('apple silicon') ||
      (ua.includes('arm') && !ua.includes('darwin')) ||
      (ua.includes('apple') && !ua.includes('applewebkit'));

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
