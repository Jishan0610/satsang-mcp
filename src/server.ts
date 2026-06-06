import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamBriefing, clearSession } from './pipeline.js';
import { log } from './logger.js';

// Langfuse OTel — only activates if LANGFUSE_SECRET_KEY is set
if (process.env.LANGFUSE_SECRET_KEY) {
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { LangfuseSpanProcessor } = await import('@langfuse/otel');
  const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
  sdk.start();
  log.info('Langfuse telemetry enabled');
} else {
  log.info('Langfuse telemetry disabled (set LANGFUSE_SECRET_KEY to enable)');
}

if (!process.env.ANTHROPIC_API_KEY) {
  log.error('ANTHROPIC_API_KEY not set in .env');
  process.exit(1);
}

const INDEX_PATH = resolve(process.cwd(), 'public/index.html');
if (!existsSync(INDEX_PATH)) {
  log.error('index.html not found', { path: INDEX_PATH });
  process.exit(1);
}
const INDEX_HTML = readFileSync(INDEX_PATH, 'utf-8');

const app = new Hono();

app.get('/healthz', (c) => c.json({ status: 'ok' }));

app.get('/', (c) => c.html(INDEX_HTML));

app.post('/api/brief', async (c) => {
  const body = await c.req.json<{
    message: string;
    language?: string;
    session_id?: string;
    model?: string;
  }>();

  const { message, language = 'english', session_id, model } = body;
  if (!message?.trim()) {
    log.warn('POST /api/brief rejected — empty message');
    return c.json({ error: 'message required' }, 400);
  }

  const sessionId = session_id ?? crypto.randomUUID();
  log.info('POST /api/brief', {
    sessionId,
    language,
    model: model || 'default',
    msgLen: message.length,
  });

  const abort = new AbortController();

  return new Response(
    new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          for await (const event of streamBriefing({
            message,
            language,
            sessionId,
            model,
            signal: abort.signal,
          })) {
            controller.enqueue(enc.encode(JSON.stringify(event) + '\n'));
          }
        } catch (err) {
          log.error('stream pump failed', { err: String(err) });
        } finally {
          controller.close();
        }
      },
      cancel() {
        log.info('client disconnected — aborting stream', { sessionId });
        abort.abort();
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } },
  );
});

app.delete('/api/session/:id', (c) => {
  const id = c.req.param('id');
  clearSession(id);
  return c.json({ ok: true });
});

const port = Number(process.env.SAMPARK_PORT ?? 8000);
serve({ fetch: app.fetch, port });
log.info(`server listening on http://localhost:${port}`);
