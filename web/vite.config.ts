import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** 与 server/src/config.ts 一致：读项目根目录 .env 里的 PORT，避免代理死写 8787 而后端改了端口 */
const projectRoot = path.resolve(__dirname, '..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  /** 与根目录 .env 的 PORT 一致：后端 API 端口（Vite 自身默认仍为 5173） */
  const n = Number(env.PORT)
  const apiPort = Number.isFinite(n) && n > 0 ? n : 8787
  const apiTarget = `http://127.0.0.1:${apiPort}`
  const apiProxy = {
    '/api': { target: apiTarget, changeOrigin: true },
    '/health': { target: apiTarget, changeOrigin: true },
  } as const

  /**
   * 根目录 HOST=0.0.0.0 只作用于后端 Fastify；Vite 需单独设 host。
   * 与后端一致：当 HOST 为 0.0.0.0 时，开发服务器也监听局域网（或设 VITE_DEV_HOST=true）。
   */
  const exposeToLan =
    env.HOST === '0.0.0.0' ||
    env.VITE_DEV_HOST === 'true' ||
    env.VITE_DEV_HOST === '0.0.0.0'

  return {
    plugins: [react()],
    server: {
      host: exposeToLan ? true : false,
      proxy: { ...apiProxy },
    },
    /** `vite preview` 本地看 dist 时同样转发 /api，需另开 server */
    preview: {
      host: exposeToLan ? true : false,
      proxy: { ...apiProxy },
    },
  }
})
