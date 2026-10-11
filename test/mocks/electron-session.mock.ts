/**
 * In-memory Mock implementation of Electron.Session and cookies.
 * Enables zero-credential offline testing of auth, session, and API pipelines.
 */

export interface MockCookie {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
}

export type FetchHandler = (
  url: string,
  init?: RequestInit
) => Promise<Response> | Response | undefined

export class MockSession {
  private cookiesMap = new Map<string, MockCookie>()
  private fetchHandlers: FetchHandler[] = []

  public cookies = {
    get: async (filter?: { url?: string; domain?: string; name?: string }): Promise<MockCookie[]> => {
      const all = Array.from(this.cookiesMap.values())
      return all.filter(c => {
        if (filter?.name && c.name !== filter.name) return false
        if (filter?.domain) {
          const dom = filter.domain.startsWith('.') ? filter.domain.slice(1) : filter.domain
          if (!c.domain || (!c.domain.includes(dom) && !dom.includes(c.domain))) return false
        }
        if (filter?.url) {
          try {
            const u = new URL(filter.url)
            if (c.domain && !u.hostname.endsWith(c.domain.replace(/^\./, ''))) {
              return false
            }
          } catch {
            return false
          }
        }
        return true
      })
    },
    set: async (details: { url?: string; name: string; value: string; domain?: string }): Promise<void> => {
      let domain = details.domain
      if (!domain && details.url) {
        try {
          domain = new URL(details.url).hostname
        } catch {
          domain = 'sjtu.edu.cn'
        }
      }
      const key = `${domain || ''}:${details.name}`
      this.cookiesMap.set(key, {
        name: details.name,
        value: details.value,
        domain
      })
    },
    remove: async (url: string, name: string): Promise<void> => {
      let domain = ''
      try { domain = new URL(url).hostname } catch {}
      for (const [key, c] of this.cookiesMap.entries()) {
        if (c.name === name && (!domain || c.domain?.includes(domain) || domain.includes(c.domain || ''))) {
          this.cookiesMap.delete(key)
        }
      }
    }
  }

  public registerFetchHandler(handler: FetchHandler): () => void {
    this.fetchHandlers.push(handler)
    return () => {
      const idx = this.fetchHandlers.indexOf(handler)
      if (idx >= 0) this.fetchHandlers.splice(idx, 1)
    }
  }

  public fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    for (const h of [...this.fetchHandlers].reverse()) {
      const res = await h(url, init)
      if (res) return res
    }
    // Default 404 response for unhandled mock URLs
    return new Response(JSON.stringify({ error: `Mock URL not handled: ${url}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  public clearStorageData = async (opts?: { storages?: string[] }): Promise<void> => {
    if (!opts || !opts.storages || opts.storages.includes('cookies')) {
      this.cookiesMap.clear()
    }
  }

  public reset(): void {
    this.cookiesMap.clear()
    this.fetchHandlers = []
  }
}

/** Global singleton mock session */
export const mockSjtuSession = new MockSession()
