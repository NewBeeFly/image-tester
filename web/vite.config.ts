import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** 与 server/src/config.ts 一致：读项目根目录 .env 里的 PORT，避免代理死写 8787 而后端改了端口 */
const projectRoot = path.resolve(__dirname, '..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  const n = Number(env.PORT)
  const port = Number.isFinite(n) && n > 0 ? n : 8787
  const apiTarget = `http://127.0.0.1:${port}`
  const apiProxy = {
    '/api': { target: apiTarget, changeOrigin: true },
    '/health': { target: apiTarget, changeOrigin: true },
  } as const

  return {
    plugins: [react()],
    server: { proxy: { ...apiProxy } },
    /** `vite preview` 本地看 dist 时同样转发 /api，需另开 server */
    preview: { proxy: { ...apiProxy } },
  }
})
