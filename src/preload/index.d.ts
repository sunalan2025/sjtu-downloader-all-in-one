import type { ExposedApi } from './index'

declare global {
  interface Window {
    api: ExposedApi
  }
}

export {}
