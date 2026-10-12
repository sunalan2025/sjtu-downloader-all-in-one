import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dialog, shell } from 'electron'
import { MockSession } from '../mocks/electron-session.mock'
import * as cloudpanModule from '../../src/main/cloudpan'
import {
  setSession,
  clearCachedCredentials,
  setCachedUserToken,
  listDirectoryContents,
  createDirectory,
  deleteCloudItem,
  renameCloudItem,
  getFileDownloadUrl,
  strictEncodeURIComponent,
  getCloudPanWebUrl
} from '../../src/main/cloudpan'
import {
  downloadCloudFile,
  uploadCloudFiles,
  openCloudInBrowser,
  activeUploadPromises
} from '../../src/main/cloudpan-transfer'
import { pendingLocal, pendingLocalIds } from '../../src/main/download-engine/shared'
import * as progressModule from '../../src/main/download-engine/progress'
import { scheduleNext } from '../../src/main/download-engine/local'
import { getMainWindow } from '../../src/main/window'
import type { CloudPanDirectoryListing, CloudPanItem } from '../../src/shared/types'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => join(tmpdir(), `sjtu-test-${name}`)),
    whenReady: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
    quit: vi.fn()
  },
  dialog: {
    showOpenDialog: vi.fn()
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined)
  },
  BrowserWindow: class {
    loadURL = vi.fn().mockResolvedValue(undefined)
    isDestroyed = vi.fn().mockReturnValue(false)
    destroy = vi.fn()
  }
}))

vi.mock('../../src/main/window', () => ({
  getMainWindow: vi.fn(() => null),
  getIsQuitting: vi.fn(() => false)
}))

vi.mock('../../src/main/download-engine/local', () => ({
  scheduleNext: vi.fn()
}))

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

describe('CloudPan Transfer & Browser Integration Suite (Task 2)', () => {
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
    setCachedUserToken(userToken)
    pendingLocal.length = 0
    pendingLocalIds.clear()
    vi.clearAllMocks()

    mockSession.registerFetchHandler(url => {
      if (url.includes('/user/v1/space/1/personal')) {
        return new Response(JSON.stringify(mockCred), { status: 200 })
      }
      if (url.includes('/api/v1/file/lib_test_01/sp_test_personal')) {
        return new Response(
          JSON.stringify({
            cosUrl: 'https://pan-cos.sjtu.edu.cn/download/test-file.pdf?sign=xyz'
          }),
          { status: 200 }
        )
      }
      return undefined
    })
  })

  afterEach(() => {
    pendingLocal.length = 0
    pendingLocalIds.clear()
  })

  // ─────────────────────────────────────────────────────────────
  // 1. downloadCloudFile (cloudpan:download-file)
  // ─────────────────────────────────────────────────────────────
  describe('downloadCloudFile (cloudpan:download-file)', () => {
    it('returns error when not logged in (userToken is empty)', async () => {
      clearCachedCredentials()
      const res = await downloadCloudFile(['test.pdf'])
      expect(res.ok).toBe(false)
      expect(res.error).toBe('未登录云盘')
      expect(pendingLocal.length).toBe(0)
    })

    it('returns error when remotePath is empty', async () => {
      const res = await downloadCloudFile([])
      expect(res.ok).toBe(false)
      expect(res.error).toBe('文件路径不能为空')
      expect(pendingLocal.length).toBe(0)
    })

    it('returns error when file name is blank', async () => {
      const res = await downloadCloudFile(['   '])
      expect(res.ok).toBe(false)
      expect(res.error).toBe('文件路径不能为空')
      expect(pendingLocal.length).toBe(0)
    })

    it('enqueues task into pendingLocal and emits progress with proper taskId and spec', async () => {
      const emitSpy = vi.spyOn(progressModule, 'emitProgress')
      const targetDir = join(tmpdir(), 'sjtu-test-download-target')

      const res = await downloadCloudFile(['课程课件', '高等数学讲义.pdf'], targetDir)

      expect(res.ok).toBe(true)
      expect(res.taskId).toBeDefined()
      expect(res.taskId).toMatch(/^cloudpan_dl_\d+_[a-z0-9]+$/)

      expect(pendingLocal.length).toBe(1)
      const pendingItem = pendingLocal[0]
      expect(pendingItem.spec.taskId).toBe(res.taskId)
      expect(pendingItem.spec.url).toBe('https://pan-cos.sjtu.edu.cn/download/test-file.pdf?sign=xyz')
      expect(pendingItem.spec.fileName).toBe('高等数学讲义.pdf')
      expect(pendingItem.spec.courseName).toBe('交大云盘')
      expect(pendingItem.spec.category).toBe('files')

      expect(pendingItem.filePath).toBe(join(targetDir, '高等数学讲义.pdf'))
      expect(pendingItem.partPath).toBe(join(targetDir, '高等数学讲义.pdf.part'))
      expect(pendingLocalIds.has(res.taskId!)).toBe(true)

      expect(emitSpy).toHaveBeenCalledWith({
        taskId: res.taskId!,
        state: 'pending',
        received: 0,
        total: 0
      })
      expect(scheduleNext).toHaveBeenCalled()
    })

    it('uses fallback downloads directory when targetDir is omitted', async () => {
      const res = await downloadCloudFile(['资料.pdf'])
      expect(res.ok).toBe(true)
      expect(res.taskId).toBeDefined()
      expect(pendingLocal.length).toBe(1)
      expect(pendingLocal[0].filePath).toContain('资料.pdf')
    })

    it('gracefully handles getFileDownloadUrl failure and returns error', async () => {
      mockSession.registerFetchHandler(url => {
        if (url.includes('/api/v1/file/lib_test_01/sp_test_personal')) {
          return new Response(JSON.stringify({ code: 'NoSuchFile', message: 'File not found' }), {
            status: 404
          })
        }
        return undefined
      })

      const res = await downloadCloudFile(['nonexistent.pdf'])
      expect(res.ok).toBe(false)
      expect(res.error).toContain('HTTP 404')
      expect(pendingLocal.length).toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. uploadCloudFiles (cloudpan:upload-files)
  // ─────────────────────────────────────────────────────────────
  describe('uploadCloudFiles (cloudpan:upload-files)', () => {
    it('returns error when not logged in', async () => {
      clearCachedCredentials()
      const res = await uploadCloudFiles(['资料'])
      expect(res.ok).toBe(false)
      expect(res.error).toBe('未登录云盘')
    })

    it('returns count 0 when user cancels dialog', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: true,
        filePaths: []
      })

      const res = await uploadCloudFiles(['课件'])
      expect(res.ok).toBe(true)
      expect(res.count).toBe(0)
    })

    it('returns count 0 when filePaths is empty', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: []
      })

      const res = await uploadCloudFiles(['课件'])
      expect(res.ok).toBe(true)
      expect(res.count).toBe(0)
    })

    it('successfully initiates upload and emits progress and done for selected files', async () => {
      const emitSpy = vi.spyOn(progressModule, 'emitProgress')
      const uploadSpy = vi.spyOn(cloudpanModule, 'uploadLocalFileToCloud').mockImplementation(
        async (_token, _local, _remote, _strat, onProgress) => {
          onProgress?.(50, 100)
          return { name: 'test.pdf', size: '100', type: 'file', path: ['test.pdf'], status: 0 }
        }
      )

      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/homework1.pdf', '/tmp/homework2.pdf']
      })

      const res = await uploadCloudFiles(['2026', '作业'])
      expect(res.ok).toBe(true)
      expect(res.count).toBe(2)

      // Wait for all background uploads to complete
      await Promise.all(Array.from(activeUploadPromises))

      expect(uploadSpy).toHaveBeenCalledTimes(2)
      expect(uploadSpy).toHaveBeenCalledWith(
        userToken,
        '/tmp/homework1.pdf',
        '2026/作业/homework1.pdf',
        'overwrite',
        expect.any(Function)
      )
      expect(uploadSpy).toHaveBeenCalledWith(
        userToken,
        '/tmp/homework2.pdf',
        '2026/作业/homework2.pdf',
        'overwrite',
        expect.any(Function)
      )

      const emitCalls = emitSpy.mock.calls.map(c => c[0])
      expect(emitCalls.some(p => p.state === 'pending')).toBe(true)
      expect(emitCalls.some(p => p.state === 'downloading' && p.received === 50)).toBe(true)
      expect(emitCalls.some(p => p.state === 'done' && p.cloudPath === '2026/作业/homework1.pdf')).toBe(true)
      expect(emitCalls.some(p => p.state === 'done' && p.cloudPath === '2026/作业/homework2.pdf')).toBe(true)
    })

    it('passes mainWindow to dialog.showOpenDialog when window exists', async () => {
      const mockWin = { id: 1 } as any
      vi.mocked(getMainWindow).mockReturnValueOnce(mockWin)
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: true,
        filePaths: []
      })

      await uploadCloudFiles([])
      expect(dialog.showOpenDialog).toHaveBeenCalledWith(mockWin, expect.any(Object))
    })

    it('emits error progress when uploadLocalFileToCloud fails', async () => {
      const emitSpy = vi.spyOn(progressModule, 'emitProgress')
      vi.spyOn(cloudpanModule, 'uploadLocalFileToCloud').mockRejectedValueOnce(
        new Error('COS connection timed out')
      )

      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/broken.pdf']
      })

      const res = await uploadCloudFiles([])
      expect(res.ok).toBe(true)
      expect(res.count).toBe(1)

      await Promise.all(Array.from(activeUploadPromises))

      const emitCalls = emitSpy.mock.calls.map(c => c[0])
      const errorProg = emitCalls.find(p => p.state === 'error')
      expect(errorProg).toBeDefined()
      expect(errorProg?.message).toContain('COS connection timed out')
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. openCloudInBrowser & getCloudPanWebUrl (cloudpan:open-web)
  // ─────────────────────────────────────────────────────────────
  describe('openCloudInBrowser & getCloudPanWebUrl (cloudpan:open-web)', () => {
    it('constructs correct web URL for root directory', () => {
      expect(getCloudPanWebUrl([])).toBe('https://pan.sjtu.edu.cn/#/files/')
      expect(getCloudPanWebUrl()).toBe('https://pan.sjtu.edu.cn/#/files/')
    })

    it('constructs correct web URL with encoded paths for nested directories and special characters', () => {
      const url = getCloudPanWebUrl(['大三课件', '软件工程 (上)'])
      expect(url).toBe('https://pan.sjtu.edu.cn/#/files/%E5%A4%A7%E4%B8%89%E8%AF%BE%E4%BB%B6/%E8%BD%AF%E4%BB%B6%E5%B7%A5%E7%A8%8B%20(%E4%B8%8A)')
    })

    it('opens root URL in browser via shell.openExternal', async () => {
      const res = await openCloudInBrowser([])
      expect(res.ok).toBe(true)
      expect(shell.openExternal).toHaveBeenCalledWith('https://pan.sjtu.edu.cn/#/files/')
    })

    it('opens nested directory in browser via shell.openExternal', async () => {
      const res = await openCloudInBrowser(['期末复习', '试卷.pdf'])
      expect(res.ok).toBe(true)
      expect(shell.openExternal).toHaveBeenCalledWith(
        'https://pan.sjtu.edu.cn/#/files/%E6%9C%9F%E6%9C%AB%E5%A4%8D%E4%B9%A0/%E8%AF%95%E5%8D%B7.pdf'
      )
    })

    it('gracefully returns error when shell.openExternal throws', async () => {
      vi.mocked(shell.openExternal).mockRejectedValueOnce(new Error('Browser not found'))
      const res = await openCloudInBrowser(['path'])
      expect(res.ok).toBe(false)
      expect(res.error).toContain('Browser not found')
    })
  })
})

