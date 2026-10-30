/**
 * 课表与日程管理 IPC 处理器
 */
import { ipcMain, dialog, type BrowserWindow } from 'electron'
import type Electron from 'electron'
import { writeFileSync } from 'node:fs'
import type { ScheduleEvent, IcsExportOptions, ScheduleFetchResult, IcsExportResult, JiaowuScheduleResult } from '../../shared/types'
import { fetchAllScheduleEvents, fetchJiaowuSchedule } from './schedule-fetcher'
import { generateIcsContent } from './ics-generator'
import { validateIpcSender, DEFAULT_UNTRUSTED_IPC_ERROR } from '../utils/ipc-guard'

let appSession: Electron.Session | null = null
let mainWindowGetter: (() => BrowserWindow | null) | null = null

export function setScheduleSession(ses: Electron.Session): void {
  appSession = ses
}

export function registerScheduleHandlers(
  ses: Electron.Session,
  getMainWindow: () => BrowserWindow | null
): void {
  appSession = ses
  mainWindowGetter = getMainWindow

  const handle: typeof ipcMain.handle = (channel, listener) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!validateIpcSender(event)) {
        return { ok: false, error: DEFAULT_UNTRUSTED_IPC_ERROR }
      }
      return listener(event, ...args)
    })

  handle(
    'schedule:fetch-events',
    async (_e, options?: { startDate?: string; endDate?: string }): Promise<ScheduleFetchResult> => {
      if (!appSession) {
        return { ok: false, events: [], error: '未初始化 Session' }
      }
      return fetchAllScheduleEvents(appSession, options)
    }
  )

  handle(
    'schedule:fetch-jiaowu',
    async (_e, xnm?: string, xqm?: string): Promise<JiaowuScheduleResult> => {
      if (!appSession) {
        return {
          ok: false,
          xnm: xnm || '2026',
          xqm: xqm || '3',
          termTitle: '',
          courses: [],
          error: '未初始化 Session'
        }
      }
      return fetchJiaowuSchedule(appSession, xnm, xqm)
    }
  )

  handle(
    'schedule:export-ics',
    async (
      _e,
      options: IcsExportOptions,
      events: ScheduleEvent[]
    ): Promise<IcsExportResult> => {
      try {
        let targetPath = options.targetFilePath
        if (!targetPath) {
          const win = mainWindowGetter ? mainWindowGetter() : null
          const todayStr = new Date().toISOString().slice(0, 10)
          const defName = `SJTU-课表与日程-${todayStr}.ics`
          const dialogOpts: Electron.SaveDialogOptions = {
            title: '导出标准日历文件 (.ics)',
            defaultPath: defName,
            filters: [
              { name: 'iCalendar 日历文件 (*.ics)', extensions: ['ics'] },
              { name: '所有文件 (*.*)', extensions: ['*'] }
            ]
          }
          const res = win
            ? await dialog.showSaveDialog(win, dialogOpts)
            : await dialog.showSaveDialog(dialogOpts)

          if (res.canceled || !res.filePath) {
            return { ok: false, cancelled: true }
          }
          targetPath = res.filePath
        }

        const icsText = generateIcsContent(events, options)
        writeFileSync(targetPath, icsText, 'utf-8')

        return {
          ok: true,
          path: targetPath,
          count: events.length
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: msg }
      }
    }
  )
}
