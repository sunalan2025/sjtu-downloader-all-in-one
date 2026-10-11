// SJTU 会话（persist:sjtu partition）封装
//
// persist:sjtu 是 v.sjtu / Canvas / 好大学在线 / vshare 共用的 jAccount 会话 partition，
// 登录后 cookie 跨重启持久化。本模块只暴露 session 句柄获取 + 纯存储清理；
// 清理的编排逻辑（invalidate 各 SSO 标志、重置 auth/cloudpan 内存态）由调用方
// （index.ts 的 clearSjtuSession）组合，避免本模块反向依赖各业务模块。

import { session } from 'electron'
import { SJTU_PARTITION } from '../shared/types'

/** persist:sjtu session 句柄。所有 SJTU 域请求复用此 session 以共享 jAccount cookie。 */
export const sjtuSession = (): Electron.Session => session.fromPartition(SJTU_PARTITION)

/** 仅清 persist:sjtu 的持久化存储（cookies/localstorage/cachestorage/serviceworkers/indexdb）。
 *  不含 SSO 标志重置 / auth 内存态重置 / cloudpan 凭证清理 —— 那些由 clearSjtuSession 编排。 */
export async function clearSjtuSessionCookies(): Promise<void> {
  await sjtuSession().clearStorageData({
    storages: ['cookies', 'localstorage', 'cachestorage', 'serviceworkers', 'indexdb']
  })
}
