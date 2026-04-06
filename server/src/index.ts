import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { registerRoutes } from './controller/http.js';
import { openDatabase } from './db.js';

async function main() {
  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 80,
    },
  });

  const db = openDatabase();
  registerRoutes(app, db);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API 已启动：http://${config.host}:${config.port}`);
  app.log.info(
    '关键路由：POST /api/vision/preview（单图检测）、POST /api/test-suites/:id/upload（multipart 上传图片/JSON）、GET /api/test-suites/:id/scan-images；若前端 404 请确认连的是本进程端口。',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
