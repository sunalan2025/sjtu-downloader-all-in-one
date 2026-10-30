import type { StateStorage } from 'zustand/middleware'

/**
 * 降级默认存储，当未显式传入底层 Storage 时（如测试环境或非浏览器运行时）提供安全空操作保护。
 */
const createFallbackStorage = (): StateStorage => ({
  getItem: (name: string) => {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(name)
      }
    } catch {
      // 忽略无法访问 localStorage 的异常
    }
    return null
  },
  setItem: (name: string, value: string) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(name, value)
      }
    } catch {
      // 忽略写入异常
    }
  },
  removeItem: (name: string) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(name)
      }
    } catch {
      // 忽略移除异常
    }
  }
})

/**
 * Zustand persist 存储脏检查适配器 (A18)。
 *
 * 维护内存中每个键上一次序列化后的字符串。当 setItem 传入的值与上一次完全一致时，
 * 提前返回并不触发底层存储（如 localStorage / 磁盘）的写入，从而彻底消除高频运行时进度更新导致的频繁写盘。
 *
 * @param underlyingStorage 底层实际执行读写的 StateStorage 实例（默认采用 localStorage 降级）
 * @returns 具备序列化去重特性的 StateStorage 包装实例
 */
export function createDeduplicatedStorage(underlyingStorage?: StateStorage): StateStorage {
  const storage = underlyingStorage ?? createFallbackStorage()
  const lastSerializedMap = new Map<string, string>()

  return {
    getItem: (name: string) => {
      const result = storage.getItem(name)
      if (result instanceof Promise) {
        return result.then((val) => {
          if (typeof val === 'string') {
            lastSerializedMap.set(name, val)
          }
          return val
        })
      }
      if (typeof result === 'string') {
        lastSerializedMap.set(name, result)
      }
      return result
    },
    setItem: (name: string, value: string) => {
      if (lastSerializedMap.get(name) === value) {
        return
      }
      lastSerializedMap.set(name, value)
      return storage.setItem(name, value)
    },
    removeItem: (name: string) => {
      lastSerializedMap.delete(name)
      return storage.removeItem(name)
    }
  }
}
