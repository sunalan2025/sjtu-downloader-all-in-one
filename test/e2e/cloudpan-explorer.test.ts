import { describe, it, expect, beforeEach } from 'vitest'
import { MockSession } from '../mocks/electron-session.mock'
import {
  setSession,
  clearCachedCredentials,
  listDirectoryContents,
  createDirectory,
  deleteCloudItem,
  renameCloudItem,
  getFileDownloadUrl,
  strictEncodeURIComponent
} from '../../src/main/cloudpan'
import type { CloudPanDirectoryListing, CloudPanItem } from '../../src/shared/types'

describe('CloudPan Explorer SMH API Protocol Suite (Task 1)', () => {
  let mockSession: MockSession
  const userToken = 'valid_test_user_token_32_characters_long'
  const mockCred = {
    libraryId: 'lib_test_01',
    spaceId: 'sp_test_personal',
    accessToken: 'access_token_mock_123',
    expiresIn: 7200
  }

  beforeEach(() => {
    mockSession = new MockSession()
    setSession(mockSession as any)
    clearCachedCredentials()

    // Default handler for space credentials
    mockSession.registerFetchHandler((url, init) => {
      if (url.includes('/user/v1/space/1/personal')) {
        return new Response(JSON.stringify(mockCred), { status: 200 })
      }
      return undefined
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 1. listDirectoryContents
  // ─────────────────────────────────────────────────────────────
  describe('listDirectoryContents', () => {
    it('lists root directory and correctly maps directory listing fields', async () => {
      let requestedUrl = ''
      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/directory/lib_test_01/sp_test_personal')) {
          requestedUrl = url
          return new Response(
            JSON.stringify({
              contents: [
                {
                  name: '数学分析',
                  type: 'dir',
                  modificationTime: '2026-10-10T08:00:00Z',
                  creationTime: '2026-09-01T08:00:00Z'
                },
                {
                  name: '课程大纲.pdf',
                  type: 'file',
                  size: 1048576,
                  fileType: 'pdf',
                  modificationTime: '2026-10-11T12:00:00Z',
                  creationTime: '2026-10-11T10:00:00Z',
                  crc64: '1234567890'
                }
              ],
              totalNum: 2,
              page: 1,
              pageSize: 100
            }),
            { status: 200 }
          )
        }
        return undefined
      })

      const listing: CloudPanDirectoryListing = await listDirectoryContents(userToken, [], 1, 100)

      expect(requestedUrl).toContain('/api/v1/directory/lib_test_01/sp_test_personal')
      expect(requestedUrl).toContain('access_token=access_token_mock_123')
      expect(requestedUrl).toContain('page=1')
      expect(requestedUrl).toContain('page_size=100')
      expect(requestedUrl).toContain('order_by=name')

      expect(listing.path).toEqual([])
      expect(listing.currentDirName).toBe('')
      expect(listing.totalNum).toBe(2)
      expect(listing.page).toBe(1)
      expect(listing.pageSize).toBe(100)
      expect(listing.contents.length).toBe(2)

      const dirItem = listing.contents[0]
      expect(dirItem.name).toBe('数学分析')
      expect(dirItem.type).toBe('dir')
      expect(dirItem.modificationTime).toBe('2026-10-10T08:00:00Z')

      const fileItem = listing.contents[1]
      expect(fileItem.name).toBe('课程大纲.pdf')
      expect(fileItem.type).toBe('file')
      expect(fileItem.size).toBe(1048576)
      expect(fileItem.fileType).toBe('pdf')
      expect(fileItem.crc64).toBe('1234567890')
    })

    it('lists nested directory with strict URL encoding for special characters', async () => {
      let requestedUrl = ''
      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/directory/lib_test_01/sp_test_personal')) {
          requestedUrl = url
          return new Response(
            JSON.stringify({
              contents: [],
              totalNum: 0,
              page: 2,
              pageSize: 50
            }),
            { status: 200 }
          )
        }
        return undefined
      })

      const pathSegments = ['2025-2026学年', '软件工程 (高级班)!']
      const listing = await listDirectoryContents(userToken, pathSegments, 2, 50)

      const expectedEncodedPath = `${strictEncodeURIComponent('2025-2026学年')}/${strictEncodeURIComponent('软件工程 (高级班)!')}`
      expect(requestedUrl).toContain(expectedEncodedPath)
      expect(requestedUrl).toContain('page=2')
      expect(requestedUrl).toContain('page_size=50')

      expect(listing.path).toEqual(pathSegments)
      expect(listing.currentDirName).toBe('软件工程 (高级班)!')
      expect(listing.totalNum).toBe(0)
      expect(listing.contents).toEqual([])
    })

    it('propagates HTTP error when SMH returns 404 or 403', async () => {
      mockSession.registerFetchHandler(url => {
        if (url.includes('/api/v1/directory/lib_test_01/sp_test_personal')) {
          return new Response(JSON.stringify({ code: 'DirectoryNotFound', message: 'Directory not found' }), {
            status: 404
          })
        }
        return undefined
      })

      await expect(listDirectoryContents(userToken, ['nonexistent'])).rejects.toThrow('HTTP 404')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. createDirectory
  // ─────────────────────────────────────────────────────────────
  describe('createDirectory', () => {
    it('creates a directory using PUT with strict URL encoding and conflict strategy', async () => {
      let methodCalled = ''
      let requestedUrl = ''

      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/directory/lib_test_01/sp_test_personal')) {
          methodCalled = init?.method || 'GET'
          requestedUrl = url
          return new Response(JSON.stringify({ path: ['新课件 (2026)'] }), { status: 200 })
        }
        return undefined
      })

      await createDirectory(userToken, ['新课件 (2026)'])

      expect(methodCalled).toBe('PUT')
      const expectedSeg = strictEncodeURIComponent('新课件 (2026)')
      expect(requestedUrl).toContain(`/api/v1/directory/lib_test_01/sp_test_personal/${expectedSeg}`)
      expect(requestedUrl).toContain('conflict_resolution_strategy=ask')
      expect(requestedUrl).toContain('access_token=access_token_mock_123')
    })

    it('creates nested directory correctly', async () => {
      let requestedUrl = ''
      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/directory/lib_test_01/sp_test_personal')) {
          requestedUrl = url
          return new Response(JSON.stringify({ path: ['level1', 'level2'] }), { status: 200 })
        }
        return undefined
      })

      await createDirectory(userToken, ['level1', 'level2'])
      expect(requestedUrl).toContain('/api/v1/directory/lib_test_01/sp_test_personal/level1/level2')
    })

    it('throws error when dirPath is empty', async () => {
      await expect(createDirectory(userToken, [])).rejects.toThrow('目录路径不能为空')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. deleteCloudItem
  // ─────────────────────────────────────────────────────────────
  describe('deleteCloudItem', () => {
    it('deletes a file with DELETE /api/v1/file/... and handles 204 No Content', async () => {
      let methodCalled = ''
      let requestedUrl = ''

      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/file/lib_test_01/sp_test_personal')) {
          methodCalled = init?.method || 'GET'
          requestedUrl = url
          return new Response(null, { status: 204 })
        }
        return undefined
      })

      await deleteCloudItem(userToken, ['资料库', '课后习题 (第一讲).pdf'], false)

      expect(methodCalled).toBe('DELETE')
      const expectedPath = `${strictEncodeURIComponent('资料库')}/${strictEncodeURIComponent('课后习题 (第一讲).pdf')}`
      expect(requestedUrl).toContain(`/api/v1/file/lib_test_01/sp_test_personal/${expectedPath}`)
      expect(requestedUrl).toContain('access_token=access_token_mock_123')
    })

    it('deletes a directory with DELETE /api/v1/directory/... and handles 204 No Content', async () => {
      let methodCalled = ''
      let requestedUrl = ''

      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/directory/lib_test_01/sp_test_personal')) {
          methodCalled = init?.method || 'GET'
          requestedUrl = url
          return new Response(null, { status: 204 })
        }
        return undefined
      })

      await deleteCloudItem(userToken, ['旧归档目录'], true)

      expect(methodCalled).toBe('DELETE')
      expect(requestedUrl).toContain(`/api/v1/directory/lib_test_01/sp_test_personal/${strictEncodeURIComponent('旧归档目录')}`)
      expect(requestedUrl).toContain('access_token=access_token_mock_123')
    })

    it('throws error when targetPath is empty', async () => {
      await expect(deleteCloudItem(userToken, [], false)).rejects.toThrow('目标路径不能为空')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. renameCloudItem
  // ─────────────────────────────────────────────────────────────
  describe('renameCloudItem', () => {
    it('renames a file via PUT with move_to query parameter and conflict_resolution_strategy=ask', async () => {
      let methodCalled = ''
      let requestedUrl = ''

      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/file/lib_test_01/sp_test_personal')) {
          methodCalled = init?.method || 'GET'
          requestedUrl = url
          return new Response(JSON.stringify({ path: ['课程资料', '重命名后的讲义 (正式).pdf'] }), { status: 200 })
        }
        return undefined
      })

      await renameCloudItem(
        userToken,
        ['课程资料', '原讲义 (草稿).pdf'],
        '重命名后的讲义 (正式).pdf',
        false
      )

      expect(methodCalled).toBe('PUT')
      const oldPathEncoded = `${strictEncodeURIComponent('课程资料')}/${strictEncodeURIComponent('原讲义 (草稿).pdf')}`
      const newPathEncoded = `${strictEncodeURIComponent('课程资料')}/${strictEncodeURIComponent('重命名后的讲义 (正式).pdf')}`

      expect(requestedUrl).toContain(`/api/v1/file/lib_test_01/sp_test_personal/${oldPathEncoded}`)
      expect(requestedUrl).toContain(`move_to=${newPathEncoded}`)
      expect(requestedUrl).toContain('conflict_resolution_strategy=ask')
      expect(requestedUrl).toContain('access_token=access_token_mock_123')
    })

    it('renames a directory via PUT /api/v1/directory/...', async () => {
      let methodCalled = ''
      let requestedUrl = ''

      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/directory/lib_test_01/sp_test_personal')) {
          methodCalled = init?.method || 'GET'
          requestedUrl = url
          return new Response(JSON.stringify({ path: ['新目录名'] }), { status: 200 })
        }
        return undefined
      })

      await renameCloudItem(userToken, ['原目录名'], '新目录名', true)

      expect(methodCalled).toBe('PUT')
      expect(requestedUrl).toContain(`/api/v1/directory/lib_test_01/sp_test_personal/${strictEncodeURIComponent('原目录名')}`)
      expect(requestedUrl).toContain(`move_to=${strictEncodeURIComponent('新目录名')}`)
      expect(requestedUrl).toContain('conflict_resolution_strategy=ask')
    })

    it('throws error when oldPath is empty or newName is blank', async () => {
      await expect(renameCloudItem(userToken, [], 'newName', false)).rejects.toThrow('路径或新名称不能为空')
      await expect(renameCloudItem(userToken, ['some_file'], '   ', false)).rejects.toThrow('路径或新名称不能为空')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 5. getFileDownloadUrl
  // ─────────────────────────────────────────────────────────────
  describe('getFileDownloadUrl', () => {
    it('returns cosUrl when SMH responds with JSON payload', async () => {
      let requestedUrl = ''
      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/file/lib_test_01/sp_test_personal')) {
          requestedUrl = url
          return new Response(
            JSON.stringify({
              cosUrl: 'https://pan-cos.sjtu.edu.cn/download/video_01.mp4?sign=xyz'
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        }
        return undefined
      })

      const downloadUrl = await getFileDownloadUrl(userToken, ['录课视频', '第1讲.mp4'])

      const expectedPath = `${strictEncodeURIComponent('录课视频')}/${strictEncodeURIComponent('第1讲.mp4')}`
      expect(requestedUrl).toContain(`/api/v1/file/lib_test_01/sp_test_personal/${expectedPath}`)
      expect(requestedUrl).toContain('download=true')
      expect(requestedUrl).toContain('access_token=access_token_mock_123')
      expect(downloadUrl).toBe('https://pan-cos.sjtu.edu.cn/download/video_01.mp4?sign=xyz')
    })

    it('returns redirected URL when SMH responds with 302 Location header', async () => {
      mockSession.registerFetchHandler((url, init) => {
        if (url.includes('/api/v1/file/lib_test_01/sp_test_personal')) {
          return new Response(null, {
            status: 302,
            headers: {
              location: 'https://pan-cos.sjtu.edu.cn/redirect-target/lecture.pdf?token=abc'
            }
          })
        }
        return undefined
      })

      const downloadUrl = await getFileDownloadUrl(userToken, ['课件.pdf'])
      expect(downloadUrl).toBe('https://pan-cos.sjtu.edu.cn/redirect-target/lecture.pdf?token=abc')
    })

    it('throws error when filePath is empty', async () => {
      await expect(getFileDownloadUrl(userToken, [])).rejects.toThrow('文件路径不能为空')
    })
  })
})
