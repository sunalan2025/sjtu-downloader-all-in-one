import { useState, useEffect } from 'react'
import { useAppStore } from '../../../store/app'
import { Segmented } from '../../../components/Segmented'
import type { PrivateWorkerTestResult, SshTunnelStatus } from '@shared/types'

export function NetworkSection() {
  const concurrency = useAppStore(s => s.concurrency)
  const setConcurrency = useAppStore(s => s.setConcurrency)
  const maxDownloadSpeedKBps = useAppStore(s => s.maxDownloadSpeedKBps)
  const setMaxDownloadSpeedKBps = useAppStore(s => s.setMaxDownloadSpeedKBps)

  const storePrivateWorkerConfig = useAppStore(s => s.privateWorkerConfig)
  const privateWorkerConfig = typeof useAppStore.getState === 'function' ? useAppStore.getState().privateWorkerConfig : storePrivateWorkerConfig
  const setPrivateWorkerConfig = useAppStore(s => s.setPrivateWorkerConfig)
  const tunnelConfig = privateWorkerConfig?.tunnel ?? {
    enabled: false,
    host: '',
    remotePort: 6880,
    localPort: 6880
  }

  const [workerTesting, setWorkerTesting] = useState(false)
  const [workerTestResult, setWorkerTestResult] = useState<PrivateWorkerTestResult | null>(null)
  const [devWorkerInfo, setDevWorkerInfo] = useState<{ isDev: boolean; devWorkerUrl: string | null } | null>(null)
  const [tunnelAccordionOpen, setTunnelAccordionOpen] = useState(false)
  const [tunnelStatus, setTunnelStatus] = useState<SshTunnelStatus | null>(null)

  useEffect(() => {
    let mounted = true
    if (typeof window !== 'undefined' && window.api?.getSshTunnelStatus) {
      window.api
        .getSshTunnelStatus()
        .then(status => {
          if (!mounted || !status) return
          setTunnelStatus(status)
        })
        .catch(() => undefined)
    }
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    if (typeof window !== 'undefined' && window.api?.credentials?.getWorkerToken) {
      window.api.credentials.getWorkerToken().then(token => {
        if (!mounted || !token) return
        if (!useAppStore.getState().privateWorkerConfig?.authToken) {
          setPrivateWorkerConfig({ authToken: token })
        }
      }).catch(() => undefined)
    }
    return () => {
      mounted = false
    }
  }, [setPrivateWorkerConfig])

  useEffect(() => {
    let mounted = true
    if (typeof window !== 'undefined' && window.api?.getDevWorkerInfo) {
      window.api.getDevWorkerInfo().then(info => {
        if (!mounted || !info) return
        setDevWorkerInfo(info)
        if (info.isDev && info.devWorkerUrl && !privateWorkerConfig.tunnel?.enabled) {
          if (!privateWorkerConfig.endpointUrl || privateWorkerConfig.endpointUrl === 'http://127.0.0.1:6880') {
            setPrivateWorkerConfig({ endpointUrl: info.devWorkerUrl })
          }
        }
      }).catch(() => undefined)
    }
    return () => {
      mounted = false
    }
  }, [privateWorkerConfig.endpointUrl, privateWorkerConfig.tunnel?.enabled, setPrivateWorkerConfig])

  const handleTestWorker = async () => {
    if (!window?.api?.testPrivateWorker) return
    setWorkerTesting(true)
    setWorkerTestResult(null)
    try {
      const res = await window.api.testPrivateWorker(
        privateWorkerConfig.endpointUrl,
        privateWorkerConfig.authToken,
        privateWorkerConfig.tunnel
      )
      setWorkerTestResult(res)
    } catch (err) {
      setWorkerTestResult({
        success: false,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setWorkerTesting(false)
      window.api?.getSshTunnelStatus?.().then(setTunnelStatus).catch(() => undefined)
    }
  }

  const handleStopTunnel = async () => {
    if (!window?.api?.stopSshTunnel) return
    try {
      await window.api.stopSshTunnel()
    } finally {
      window.api?.getSshTunnelStatus?.().then(setTunnelStatus).catch(() => undefined)
    }
  }

  const SPEED_PRESETS = [0, 5120, 10240, 25600, 51200]
  const isPresetSpeed = SPEED_PRESETS.includes(maxDownloadSpeedKBps)
  const [isCustomSpeed, setIsCustomSpeed] = useState(!isPresetSpeed && maxDownloadSpeedKBps > 0)
  const [customSpeedMBText, setCustomSpeedMBText] = useState(
    maxDownloadSpeedKBps > 0 ? (maxDownloadSpeedKBps / 1024).toFixed(1).replace(/\.0$/, '') : '10'
  )

  return (
              <section className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-text-1">传输与网络</h2>
                  <p className="mt-1 text-xs text-text-3">精细控制网络吞吐与多任务并行数，支持自定义并发与下载限速</p>
                </div>

                <div className="divide-y divide-bd border-t border-bd">
                  {/* 并发数 */}
                  <div className="py-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-text-1">最大并发任务数</div>
                        <div className="text-xs text-text-3">
                          同时进行网络传输的文件数量，千兆有线网络推荐 5~8，校园网无线 Wi-Fi 推荐 3
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 self-start sm:self-auto">
                        {[1, 3, 5, 8].map(p => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setConcurrency(p)}
                            className={`rounded-md px-2.5 py-1 text-xs font-mono transition-all cursor-pointer ${
                              concurrency === p
                                ? 'bg-accent text-white font-semibold'
                                : 'bg-surface-2 text-text-3 hover:bg-surface-3 hover:text-text-1'
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 rounded-xl bg-surface-2/60 p-3.5">
                      <span className="text-xs text-text-3 shrink-0">1</span>
                      <input
                        type="range"
                        min={1}
                        max={16}
                        step={1}
                        value={concurrency}
                        onChange={e => setConcurrency(parseInt(e.target.value, 10))}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-4 accent-accent"
                      />
                      <span className="text-xs text-text-3 shrink-0">16</span>
                      <div className="flex items-center gap-1 shrink-0 rounded-lg border border-bd bg-surface-1 px-2 py-1 shadow-2xs">
                        <input
                          type="number"
                          min={1}
                          max={16}
                          value={concurrency}
                          onChange={e => {
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val)) {
                              setConcurrency(Math.max(1, Math.min(16, val)))
                            }
                          }}
                          className="w-8 border-none bg-transparent text-center font-mono text-sm font-bold text-accent outline-none focus:ring-0"
                          title="直接键入 1~16 并发数"
                        />
                        <span className="text-2xs text-text-3 select-none">并发</span>
                      </div>
                    </div>
                  </div>

                  {/* 全局下载限速 */}
                  <div className="py-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1 max-w-sm">
                        <div className="text-sm font-medium text-text-1">全局下载限速</div>
                        <div className="text-xs text-text-3 leading-relaxed">
                          限制单机总下载带宽，避免占满网络影响其他正常业务
                        </div>
                      </div>
                      <div className="shrink-0">
                        <Segmented
                          size="md"
                          value={isCustomSpeed ? 'custom' : String(maxDownloadSpeedKBps)}
                          onChange={(v) => {
                            if (v === 'custom') {
                              setIsCustomSpeed(true)
                              const mb = parseFloat(customSpeedMBText) || 10
                              setMaxDownloadSpeedKBps(Math.round(mb * 1024))
                            } else {
                              setIsCustomSpeed(false)
                              const kbps = parseInt(v, 10)
                              setMaxDownloadSpeedKBps(kbps)
                              if (kbps > 0) {
                                setCustomSpeedMBText((kbps / 1024).toFixed(1).replace(/\.0$/, ''))
                              }
                            }
                          }}
                          options={[
                            { key: '0', label: '不限速' },
                            { key: '5120', label: '5 MB/s' },
                            { key: '10240', label: '10 MB/s' },
                            { key: '25600', label: '25 MB/s' },
                            { key: '51200', label: '50 MB/s' },
                            { key: 'custom', label: '自定义…' }
                          ]}
                        />
                      </div>
                    </div>

                    {isCustomSpeed && (
                      <div className="rounded-xl border border-bd bg-surface-2/40 p-4 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <span className="text-xs font-medium text-text-1">自定义限制速率 · MB/s</span>
                            <p className="text-2xs text-text-3">支持键入任意大小或拖动滑块连续调节</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center rounded-lg border border-bd bg-surface-1 px-2.5 py-1 shadow-2xs">
                              <input
                                type="number"
                                min={0.5}
                                max={200}
                                step={0.5}
                                value={customSpeedMBText}
                                onChange={e => {
                                  const text = e.target.value
                                  setCustomSpeedMBText(text)
                                  const num = parseFloat(text)
                                  if (!isNaN(num) && num > 0) {
                                    setMaxDownloadSpeedKBps(Math.round(num * 1024))
                                  }
                                }}
                                className="w-16 border-none bg-transparent text-right font-mono text-sm font-bold text-accent outline-none focus:ring-0"
                              />
                              <span className="ml-1 text-xs text-text-3 select-none">MB/s</span>
                            </div>
                            <span className="text-2xs text-text-4 font-mono">
                              约 {Math.round((maxDownloadSpeedKBps * 8) / 1000)} Mbps
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 pt-1">
                          <span className="text-2xs text-text-3 shrink-0 font-mono">1 MB/s</span>
                          <input
                            type="range"
                            min={1}
                            max={100}
                            step={1}
                            value={Math.min(100, Math.max(1, Math.round(maxDownloadSpeedKBps / 1024)))}
                            onChange={e => {
                              const mb = parseInt(e.target.value, 10)
                              setCustomSpeedMBText(String(mb))
                              setMaxDownloadSpeedKBps(mb * 1024)
                            }}
                            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-4 accent-accent"
                          />
                          <span className="text-2xs text-text-3 shrink-0 font-mono">100 MB/s</span>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* 校内私有中转服务（实验性） */}
                  <div className="py-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1 max-w-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-1">校内私有中转服务（实验性）</span>
                          <span className="rounded-md bg-accent/10 px-2 py-0.5 text-2xs font-semibold text-accent border border-accent/20">校内中继</span>
                        </div>
                        <div className="text-xs text-text-3 leading-relaxed">
                          将下载与转存任务委托给校内私有工作机（如寝室 Linux、实验室主机）中继执行，享受千兆对等内网高速通道
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={privateWorkerConfig.enabled}
                        onClick={() => {
                          setPrivateWorkerConfig({ enabled: !privateWorkerConfig.enabled })
                          setWorkerTestResult(null)
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                          privateWorkerConfig.enabled ? 'bg-accent' : 'bg-surface-4'
                        }`}
                        title="开启或关闭校内私有中转代传扩展"
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                            privateWorkerConfig.enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {privateWorkerConfig.enabled && (
                      <div className="rounded-2xl border border-bd bg-surface-2/50 p-4 sm:p-5 space-y-4 animate-in fade-in duration-150">
                        {devWorkerInfo?.isDev && devWorkerInfo.devWorkerUrl && !privateWorkerConfig.tunnel?.enabled && (
                          <div className="flex items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                              <span className="font-semibold">🟢 开发测试节点已自动就绪</span>
                              <span className="font-mono text-2xs opacity-80">({devWorkerInfo.devWorkerUrl})</span>
                            </div>
                            <span className="text-3xs text-text-4 font-mono select-none">无需敲命令 · 即开即测</span>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* 节点地址输入 */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-text-2">服务节点地址</span>
                              <span className="text-3xs text-text-4">支持内网 IP 或穿透域名</span>
                            </div>
                            <input
                              type="text"
                              value={privateWorkerConfig.endpointUrl}
                              onChange={e => {
                                setPrivateWorkerConfig({ endpointUrl: e.target.value })
                                setWorkerTestResult(null)
                              }}
                              placeholder="http://127.0.0.1:6880"
                              className="w-full rounded-xl border border-bd bg-surface-1 px-3.5 py-2 font-mono text-xs text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shadow-2xs"
                            />
                          </div>

                          {/* 授权密钥输入 */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-text-2">访问授权密钥 (Token)</span>
                              <span className="text-3xs text-text-4">选填 · 节点鉴权密码</span>
                            </div>
                            <input
                              type="password"
                              value={privateWorkerConfig.authToken || ''}
                              onChange={e => {
                                setPrivateWorkerConfig({ authToken: e.target.value })
                                setWorkerTestResult(null)
                              }}
                              placeholder="可选，若服务配置了密钥请输入"
                              className="w-full rounded-xl border border-bd bg-surface-1 px-3.5 py-2 font-mono text-xs text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shadow-2xs"
                            />
                          </div>
                        </div>

                        {/* 中转目标存储模式单选组 */}
                        <div className="space-y-2 pt-1 border-t border-bd/60">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-text-2">中转目标存储模式</span>
                            <span className="text-3xs text-text-4">决定中转工作机下载完成后的课件归宿</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {/* 选项 1：转存至交大云盘 (JBox) */}
                            <button
                              type="button"
                              onClick={() => setPrivateWorkerConfig({ storageMode: 'cloudpan' })}
                              className={`flex flex-col items-start p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                (privateWorkerConfig.storageMode || 'cloudpan') === 'cloudpan'
                                  ? 'border-accent bg-accent/5 ring-1 ring-accent/30 shadow-xs'
                                  : 'border-bd bg-surface-1 hover:bg-surface-2/70 text-text-3'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm">☁️</span>
                                <span className={`text-xs font-semibold ${
                                  (privateWorkerConfig.storageMode || 'cloudpan') === 'cloudpan' ? 'text-accent' : 'text-text-1'
                                }`}>
                                  转存至交大云盘 (JBox)
                                </span>
                              </div>
                              <p className="mt-1 text-2xs text-text-3 leading-relaxed">
                                免本机流量，由中转工作机下载后直接上传备份至云端 JBox 网盘
                              </p>
                            </button>

                            {/* 选项 2：保存在中转服务器本地磁盘 */}
                            <button
                              type="button"
                              onClick={() => setPrivateWorkerConfig({ storageMode: 'server_local' })}
                              className={`flex flex-col items-start p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                privateWorkerConfig.storageMode === 'server_local'
                                  ? 'border-accent bg-accent/5 ring-1 ring-accent/30 shadow-xs'
                                  : 'border-bd bg-surface-1 hover:bg-surface-2/70 text-text-3'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm">🖥️</span>
                                <span className={`text-xs font-semibold ${
                                  privateWorkerConfig.storageMode === 'server_local' ? 'text-accent' : 'text-text-1'
                                }`}>
                                  保存在中转服务器本地磁盘
                                </span>
                              </div>
                              <p className="mt-1 text-2xs text-text-3 leading-relaxed">
                                集中保存在寝室/实验室工作机中，自动按课程与课件明细分级存储
                              </p>
                            </button>
                          </div>

                          {/* 当选择保存在服务器本地磁盘时，展开根目录输入框 */}
                          {privateWorkerConfig.storageMode === 'server_local' && (
                            <div className="mt-2 rounded-xl border border-bd bg-surface-1 p-3 space-y-1.5 animate-in fade-in duration-150">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-text-2">服务器保存根目录</span>
                                <span className="text-3xs text-text-4">支持绝对路径或 ~ 家目录</span>
                              </div>
                              <input
                                type="text"
                                value={privateWorkerConfig.serverDownloadDir ?? '~/downloads'}
                                onChange={e => setPrivateWorkerConfig({ serverDownloadDir: e.target.value })}
                                placeholder="~/downloads"
                                className="w-full rounded-xl border border-bd bg-surface-2/50 px-3.5 py-2 font-mono text-xs text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shadow-2xs"
                              />
                              <div className="text-3xs text-text-3">
                                课件将自动存储于：<code className="font-mono text-text-2">{privateWorkerConfig.serverDownloadDir || '~/downloads'}/[课程名称]/[分类]/...</code>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 高级选项：通过 SSH 隧道自动连接 */}
                        <div className="rounded-xl border border-bd bg-surface-1/50 p-3.5 space-y-3">
                          <button
                            type="button"
                            onClick={() => setTunnelAccordionOpen(prev => !prev)}
                            className="flex w-full items-center justify-between text-left cursor-pointer group"
                            aria-expanded={tunnelAccordionOpen}
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-text-3 text-xs group-hover:text-text-2 transition-colors">
                                {tunnelAccordionOpen ? '▾' : '▸'}
                              </span>
                              <span className="text-xs font-semibold text-text-2 group-hover:text-text-1 transition-colors">
                                高级选项：通过 SSH 隧道自动连接
                              </span>
                              {tunnelConfig.enabled && (
                                <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-3xs font-semibold text-accent border border-accent/20">
                                  已启用
                                </span>
                              )}
                            </div>
                            <span className="text-3xs text-text-4 font-mono">
                              {tunnelAccordionOpen ? '收起 ▴' : '展开 ▾'}
                            </span>
                          </button>

                          {tunnelAccordionOpen && (
                            <div className="pt-2 space-y-3.5 border-t border-bd/60 animate-in fade-in duration-150">
                              {/* 开启 SSH 隧道自动连接开关 */}
                              <div className="flex items-center justify-between gap-4">
                                <div className="space-y-0.5">
                                  <div className="text-xs font-medium text-text-1">通过 SSH 隧道自动连接</div>
                                  <div className="text-3xs text-text-3">
                                    校外或异构网络环境下，自动通过 SSH 端口转发打通内网中转节点
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={tunnelConfig.enabled}
                                  onClick={() => {
                                    const nextEnabled = !tunnelConfig.enabled
                                    const isDefaultUrl =
                                      !privateWorkerConfig.endpointUrl ||
                                      privateWorkerConfig.endpointUrl === 'http://127.0.0.1:6880'
                                    setPrivateWorkerConfig({
                                      ...(nextEnabled && isDefaultUrl
                                        ? { endpointUrl: `http://127.0.0.1:${tunnelConfig.localPort || 6880}` }
                                        : {}),
                                      tunnel: { enabled: nextEnabled }
                                    })
                                    setWorkerTestResult(null)
                                  }}
                                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 ${
                                    tunnelConfig.enabled ? 'bg-accent' : 'bg-surface-4'
                                  }`}
                                  title="开启或关闭通过 SSH 隧道自动连接"
                                >
                                  <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ml-0.5 ${
                                      tunnelConfig.enabled ? 'translate-x-4' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </div>

                              {tunnelConfig.enabled && (
                                <div className="space-y-3 pt-1 animate-in fade-in duration-150">
                                  {/* SSH 主机别名 / 地址 */}
                                  <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="font-medium text-text-2">SSH 主机别名 / 地址</span>
                                      <span className="text-3xs text-text-4">支持 ~/.ssh/config 主机别名、内网 IP 或穿透域名</span>
                                    </div>
                                    <input
                                      type="text"
                                      value={tunnelConfig.host}
                                      onChange={e => {
                                        setPrivateWorkerConfig({
                                          tunnel: { host: e.target.value }
                                        })
                                        setWorkerTestResult(null)
                                      }}
                                      placeholder="例如 lab-gpu 或 my-server"
                                      className="w-full rounded-xl border border-bd bg-surface-1 px-3.5 py-2 font-mono text-xs text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shadow-2xs"
                                    />
                                  </div>

                                  {/* 远程中转端口与本地监听端口双栏 */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="font-medium text-text-2">远程中转端口</span>
                                        <span className="text-3xs text-text-4">远端服务端口 · 默认 6880</span>
                                      </div>
                                      <input
                                        type="number"
                                        min={1}
                                        max={65535}
                                        value={tunnelConfig.remotePort}
                                        onChange={e => {
                                          const val = parseInt(e.target.value, 10)
                                          setPrivateWorkerConfig({
                                            tunnel: { remotePort: isNaN(val) ? 6880 : val }
                                          })
                                          setWorkerTestResult(null)
                                        }}
                                        placeholder="6880"
                                        className="w-full rounded-xl border border-bd bg-surface-1 px-3.5 py-2 font-mono text-xs text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shadow-2xs"
                                      />
                                    </div>

                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="font-medium text-text-2">本地监听端口</span>
                                        <span className="text-3xs text-text-4">本机转发端口 · 默认 6880</span>
                                      </div>
                                      <input
                                        type="number"
                                        min={1}
                                        max={65535}
                                        value={tunnelConfig.localPort}
                                        onChange={e => {
                                          const val = parseInt(e.target.value, 10)
                                          const newPort = isNaN(val) ? 6880 : val
                                          const isDefaultLocalUrl =
                                            !privateWorkerConfig.endpointUrl ||
                                            privateWorkerConfig.endpointUrl === `http://127.0.0.1:${tunnelConfig.localPort}` ||
                                            privateWorkerConfig.endpointUrl === 'http://127.0.0.1:6880'
                                          setPrivateWorkerConfig({
                                            ...(isDefaultLocalUrl && !isNaN(val)
                                              ? { endpointUrl: `http://127.0.0.1:${val}` }
                                              : {}),
                                            tunnel: { localPort: newPort }
                                          })
                                          setWorkerTestResult(null)
                                        }}
                                        placeholder="6880"
                                        className="w-full rounded-xl border border-bd bg-surface-1 px-3.5 py-2 font-mono text-xs text-text-1 placeholder:text-text-4 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all shadow-2xs"
                                      />
                                    </div>
                                  </div>

                                  {/* 实时状态指示徽标 */}
                                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bd bg-surface-2/70 px-3 py-2 text-xs">
                                    {tunnelStatus?.running ? (
                                      <div className="flex items-center gap-2">
                                        <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                                          <span>🟢 隧道已连接 (PID: {tunnelStatus.pid})</span>
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5 text-text-3">
                                        <span>⚪ 隧道就绪（点击「测试服务连接」时自动建立并测通）</span>
                                      </div>
                                    )}

                                    {tunnelStatus?.running && (
                                      <button
                                        type="button"
                                        onClick={handleStopTunnel}
                                        className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-2xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:scale-95 transition-all cursor-pointer"
                                        title="断开当前 SSH 隧道"
                                      >
                                        <span>断开</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* 操作栏与测试反馈 */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-bd">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={handleTestWorker}
                              disabled={workerTesting || !privateWorkerConfig.endpointUrl.trim()}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-bd bg-surface-1 px-3.5 py-1.5 text-xs font-semibold text-text-1 shadow-2xs hover:bg-surface-2 active:scale-98 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <span>{workerTesting ? '⏳' : '⚡'}</span>
                              <span>{workerTesting ? '正在探测服务...' : '测试服务连接'}</span>
                            </button>

                            {workerTestResult && (
                              <div className="flex items-center gap-2 text-xs animate-in fade-in duration-150">
                                {workerTestResult.success ? (
                                  <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                                    <span>✓ 连接成功</span>
                                    <span className="font-mono text-2xs bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold">
                                      {workerTestResult.latencyMs}ms · v{workerTestResult.version}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 text-rose-500 font-medium max-w-sm sm:max-w-md">
                                    <span>✕</span>
                                    <span className="truncate" title={workerTestResult.error}>{workerTestResult.error}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="text-3xs text-text-4 font-mono select-none">
                            单租户私有架构 · 凭证内存即焚
                          </div>
                        </div>

                        {/* 本机极速自测说明 */}
                        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 dark:bg-sky-500/10 p-3 text-2xs text-text-3 space-y-1 leading-relaxed">
                          <div className="font-semibold text-text-1 flex items-center gap-1.5">
                            <span>💡</span>
                            <span>{devWorkerInfo?.isDev ? '开发环境无感调试说明' : '校内自建节点说明'}</span>
                          </div>
                          <p className="pl-5">
                            {devWorkerInfo?.isDev
                              ? '当前处于开发模式，主进程已在后台为您自动托管并启动了测试节点。直接点击上方的「测试服务连接」即可秒连验证，无需开终端运行额外命令！'
                              : '若需在校园网自建私有节点，可在常开的寝室/实验室机器上使用 Docker 或轻量脚本启动，并在此处填入私有 IP 或穿透域名。'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
  )
}
