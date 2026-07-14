/**
 * Agent API 路由：会话管理 + SSE 对话。
 */
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import * as agentRepo from './agentRepo.js';
import { runAgentChat, cancelAgentRun } from './agentService.js';
import { getAllAgents } from '../agents/registry.js';
import { parseOrThrow } from '../utils/zodParse.js';

const createSessionSchema = z.object({
  title: z.string().optional(),
  provider_profile_id: z.number().int().positive(),
  model: z.string().nullable().optional(),
  agent_name: z.string().default('optimizer'),
});

const chatSchema = z.object({
  session_id: z.number().int().positive(),
  message: z.string().min(1),
});

const cancelSchema = z.object({
  session_id: z.number().int().positive(),
});

export function registerAgentRoutes(app: FastifyInstance, db: Database.Database) {
  // ---- 列出可用 agents ----
  app.get('/api/agents', async () => {
    const agents = getAllAgents();
    return agents.map((a) => ({
      name: a.config.name,
      displayName: a.config.displayName,
      skills: Array.from(a.skills.keys()),
    }));
  });

  // ---- 会话 CRUD ----
  app.get('/api/agent/sessions', async () => {
    return agentRepo.listSessions(db);
  });

  app.post('/api/agent/sessions', async (req) => {
    const body = parseOrThrow(createSessionSchema, req.body);
    return agentRepo.insertSession(db, {
      title: body.title || '新对话',
      provider_profile_id: body.provider_profile_id,
      model: body.model,
      agent_name: body.agent_name,
    });
  });

  app.get('/api/agent/sessions/:id/messages', async (req) => {
    const id = Number((req.params as { id: string }).id);
    return agentRepo.listMessages(db, id);
  });

  app.delete('/api/agent/sessions/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const ok = agentRepo.deleteSession(db, id);
    return { ok };
  });

  app.patch('/api/agent/sessions/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { title?: string };
    if (body?.title) agentRepo.updateSessionTitle(db, id, body.title);
    return agentRepo.getSession(db, id);
  });

  // ---- SSE 对话 ----
  app.post('/api/agent/chat', async (req, reply) => {
    const body = parseOrThrow(chatSchema, req.body);
    const session = agentRepo.getSession(db, body.session_id);
    if (!session) {
      reply.status(404).send({ error: '会话不存在' });
      return;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });

    const send = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // 心跳：让前端知道连接还活着
    const heartbeat = setInterval(() => {
      send({ type: 'ping' });
    }, 5000);

    try {
      await runAgentChat(db, body.session_id, body.message, send);
    } catch (e) {
      send({ type: 'error', message: (e as Error).message });
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
  });

  // ---- 取消运行 ----
  app.post('/api/agent/chat/cancel', async (req) => {
    const body = parseOrThrow(cancelSchema, req.body);
    cancelAgentRun(body.session_id);
    return { ok: true };
  });
}
