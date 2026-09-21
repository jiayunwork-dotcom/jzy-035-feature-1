/**
 * HTTP/JSON API（基于 Node 内置 http，无第三方框架）。
 *
 * 路由：
 *   GET  /api/health
 *   POST /api/evaluate                 实时求值（拓扑传播 + 环检测）
 *   POST /api/truth-table              真值表穷举
 *   POST /api/expressions              SOP 布尔表达式提取（规范 + 最简）
 *   POST /api/karnaugh                 2~4 变量卡诺图
 *   GET  /api/levels                   关卡列表
 *   POST /api/levels/verify            基于真实求值的关卡判定
 *
 * 生产环境同时由 staticServer 托管前端构建产物。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from './core/evaluate.js';
import { buildTruthTable, truthTableToCsv } from './core/truthTable.js';
import { extractExpressions } from './core/expression.js';
import { buildKarnaugh } from './core/karnaugh.js';
import { LEVELS, verifyLevel } from './core/levels.js';
import type { Circuit } from './core/types.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(body);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectPromise(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        rejectPromise(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', rejectPromise);
  });
}

async function handleApi(pathname: string, data: any, res: ServerResponse): Promise<boolean> {
  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'logiclab', time: new Date().toISOString() });
    return true;
  }

  if (pathname === '/api/evaluate') {
    const circuit = data?.circuit as Circuit | undefined;
    if (!circuit) {
      sendJson(res, 400, { ok: false, message: '缺少 circuit' });
      return true;
    }
    sendJson(res, 200, evaluate(circuit, data?.inputValues ?? undefined));
    return true;
  }

  if (pathname === '/api/truth-table') {
    const result = buildTruthTable({
      circuit: data?.circuit,
      inputIds: data?.inputIds ?? [],
      outputIds: data?.outputIds ?? []
    });
    if (result.ok && data?.format === 'csv') {
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="truth-table.csv"',
        'access-control-allow-origin': '*'
      });
      res.end('﻿' + truthTableToCsv(result));
      return true;
    }
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (pathname === '/api/expressions') {
    const result = extractExpressions({
      circuit: data?.circuit,
      inputIds: data?.inputIds ?? [],
      outputIds: data?.outputIds ?? []
    });
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (pathname === '/api/karnaugh') {
    const result = buildKarnaugh({
      circuit: data?.circuit,
      inputIds: data?.inputIds ?? [],
      outputId: data?.outputId
    });
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }

  if (pathname === '/api/levels') {
    sendJson(res, 200, {
      levels: LEVELS.map(({ id, title, description, hint, inputCount, outputNames, target }) => ({
        id,
        title,
        description,
        hint,
        inputCount,
        outputNames,
        target
      }))
    });
    return true;
  }

  if (pathname === '/api/levels/verify') {
    const result = verifyLevel({ levelId: data?.levelId, circuit: data?.circuit });
    sendJson(res, result.ok === false ? 400 : 200, result);
    return true;
  }

  return false;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

/** 生产环境托管 ../frontend/dist */
async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const here = fileURLToPath(new URL('.', import.meta.url));
  // 开发(tsx)时 here=.../backend/src/；编译后 here=.../backend/dist/src/。
  // 统一取"包含 src 或 dist/src 的那一级"再拼 ../frontend/dist。
  const backendRoot = here.endsWith(`${sep}dist${sep}src${sep}`)
    ? resolve(here, '..', '..')
    : here.endsWith(`${sep}src${sep}`)
      ? resolve(here, '..')
      : resolve(here, '..');
  const distDir = resolve(backendRoot, '..', 'frontend', 'dist');
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let filePath = join(distDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    // SPA 回退
    try {
      const index = await readFile(join(distDir, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(index);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('前端尚未构建（开发模式请直接访问 Vite dev server 的 5173 端口）');
    }
  }
}

export function createApp() {
  return createServer(async (req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type'
      });
      res.end();
      return;
    }

    if (pathname.startsWith('/api/') || pathname === '/api') {
      try {
        const data = req.method === 'POST' ? await readJsonBody(req) : null;
        const handled = await handleApi(pathname, data, res);
        if (!handled) sendJson(res, 404, { ok: false, message: `未知接口: ${pathname}` });
      } catch (e) {
        sendJson(res, 400, { ok: false, message: (e as Error).message });
      }
      return;
    }

    await serveStatic(req, res);
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  createApp().listen(PORT, HOST, () => {
    console.log(`LogicLab 后端已启动: http://${HOST}:${PORT}`);
  });
}
