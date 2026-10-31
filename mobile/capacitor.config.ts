import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'me.hisunalan.sjtudownloader',
  appName: 'SJTU Downloader',
  webDir: 'dist',
  android: {
    allowMixedContent: false
  }
}

export default config
