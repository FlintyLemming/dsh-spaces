import { defineConfig } from 'vitest/config'

// 只跑本仓库的测试；dsh/ 上游检出自带 *.spec.ts（需要其自身的 pnpm
// 工作区），不能被默认 glob 扫进来。
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
  },
})
