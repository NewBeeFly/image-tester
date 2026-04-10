#!/usr/bin/env bash
# 在新机器上：安装依赖、构建、初始化 SQLite 表与数据目录。
# 用法：在项目根目录执行  bash scripts/deploy-init.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Node $(node -v)（建议 ≥ 20）"

if [[ ! -f .env ]]; then
  echo "==> 未找到 .env，从 .env.example 复制（请编辑填写 API Key 等）"
  cp .env.example .env
fi

if [[ ! -f image-tester.config.json ]] && [[ -f image-tester.config.example.json ]]; then
  echo "==> 可选：复制 image-tester.config.example.json -> image-tester.config.json 以自定义测试集根目录"
fi

echo "==> 安装依赖（server + web）"
npm install --prefix server
npm install --prefix web

echo "==> 构建 TypeScript 与前端"
npm run build --prefix server
npm run build --prefix web

echo "==> 初始化数据库表与目录（SQLite + test-suites 父目录）"
npm run init-db --prefix server

echo ""
echo "---------- 局域网访问 ----------"
echo "在 .env 中设置："
echo "  HOST=0.0.0.0"
echo "  CORS_ORIGINS=http://<本机局域网IP>:5173,http://127.0.0.1:5173,http://localhost:5173"
echo "（若前端用其它端口，把 5173 改成实际端口）"
echo ""
echo "启动："
echo "  开发（本机）:         npm run dev"
echo "  局域网内其它电脑打开前端: 需让 Vite 监听 0.0.0.0，例如："
echo "    cd web && npx vite --host 0.0.0.0"
echo "    （同时后端 .env 已设 HOST=0.0.0.0；浏览器访问 http://服务器IP:5173）"
echo "  仅 API（生产）:       cd server && npm start"
echo ""
