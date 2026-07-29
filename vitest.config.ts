import { defineConfig } from 'vitest/config'

// 最小测试基础设施：node 环境，仅跑 src 下 *.test.ts。
// 不配 coverage（先立习惯，覆盖率留给后续批次）。
// electron / zustand store 等运行时副作用的依赖在各测试文件里用 vi.mock 拦截。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false
  }
})
