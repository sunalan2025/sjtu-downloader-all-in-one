import net from 'node:net'

/**
 * 测试指定主机与端口是否能真正成功绑定。
 * 在 Windows 上，若遇到 EADDRINUSE 或由于 TUN/Hyper-V/权限引发的 EACCES，均视为不可用并返回 false。
 *
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
export function testPortAvailability(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => {
      resolve(false)
    })
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * 寻找第一个既无进程占用、又未被 Windows/TUN 保留禁用的可用端口。
 *
 * Hyper-V/WSL 会保留大段「排除范围」（netsh interface ipv4 show excludedportrange），
 * 常见配置下 5141–5757 整段被排除——起始窗口 50 次探测可能全部 EACCES。
 * 故探测分两段：先扫 defaultPort 起的紧凑窗口（偏好常用端口），全失败后再
 * 跳到排除段之后的 6000 起扫第二窗口。仍失败则兜底返回 defaultPort（调用方
 * 自行决定是否继续；返回值不保证可绑定——与旧行为一致，但两段扫描后基本不
 * 会再落空）。
 *
 * @param {number} defaultPort 起始探测端口，默认 5173
 * @param {string} host 绑定主机，默认 127.0.0.1
 * @param {number} maxTries 每段最大递增尝试次数，默认 50
 * @returns {Promise<number>}
 */
export async function getSafeAvailablePort(defaultPort = 5173, host = '127.0.0.1', maxTries = 50) {
  // 第一段：defaultPort 起的紧凑窗口（偏好常用端口）
  for (let port = defaultPort; port < defaultPort + maxTries; port++) {
    if (await testPortAvailability(port, host)) return port
  }
  // 第二段：跳过 Windows 常见排除段（5141–5757 一带），从 6000 起再扫
  for (let port = 6000; port < 6000 + maxTries; port++) {
    if (await testPortAvailability(port, host)) return port
  }
  return defaultPort
}
