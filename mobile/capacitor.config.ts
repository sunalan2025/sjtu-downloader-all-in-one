import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'me.hisunalan.sjtudownloader.beta',
  appName: 'SJTU Downloader Beta',
  webDir: 'dist',
  android: {
    allowMixedContent: false
  }
}

export default config
