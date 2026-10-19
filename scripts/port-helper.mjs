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
 * @param {number} defaultPort 起始探测端口，默认 5173
 * @param {string} host 绑定主机，默认 127.0.0.1
 * @param {number} maxTries 最大递增尝试次数，默认 50
 * @returns {Promise<number>}
 */
export async function getSafeAvailablePort(defaultPort = 5173, host = '127.0.0.1', maxTries = 50) {
  for (let port = defaultPort; port < defaultPort + maxTries; port++) {
    const ok = await testPortAvailability(port, host)
    if (ok) return port
  }
  return defaultPort
}
