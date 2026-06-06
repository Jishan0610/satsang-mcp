import { streamText, stepCountIs } from 'ai';
import { listSermons, readSermon } from './tools.js';
import { KK_ASSISTANT_SYSTEM_PROMPT, MAX_STEPS } from './agent.js';
import { log } from './logger.js';
import { DEFAULT_MODEL, resolveModel } from './models.js';
import {
  hashPrompt,
  inferProvider,
  newRunId,
  recordRun,
  type RunRecord,
} from './runs.js';

type ConversationMessage = { role: 'user' | 'assistant'; content: string };
type Event = Record<string, unknown>;

const HEARTBEAT_MS = 5000;
const TELEMETRY_ENABLED = Boolean(process.env.LANGFUSE_SECRET_KEY);
export { DEFAULT_MODEL } from './models.js';

// In-memory session store: sessionId → conversation history
const sessions = new Map<string, ConversationMessage[]>();

export type BriefingOptions = {
  message: string;
  language: string;
  sessionId: string;
  model?: string;
  signal?: AbortSignal;
};

export async function* streamBriefing(
  opts: BriefingOptions,
): AsyncGenerator<Event> {
  const { message, language, sessionId, signal } = opts;
  const model = opts.model?.trim() || DEFAULT_MODEL;
  const started = Date.now();
  const historyLen = sessions.get(sessionId)?.length ?? 0;
  log.info('briefing start', {
    sessionId,
    language,
    model,
    msgLen: message.length,
    historyLen,
  });
  yield { type: 'start' };

  // Accumulators for the eval run record.
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  const sermonsRead: string[] = [];
  let usageIn = 0;
  let usageOut = 0;
  let runStatus: 'success' | 'error' = 'error';
  let runError: string | undefined;

  const history = sessions.get(sessionId) ?? [];
  const userContent = `${message.trim()}\n\nResponse language: ${language}`;
  const userMessage: ConversationMessage = { role: 'user', content: userContent };
  const messages: ConversationMessage[] = [...history, userMessage];

  // Buffer + waker pattern — lets us interleave heartbeats and stream events.
  const buffer: Event[] = [];
  let wake: (() => void) | null = null;
  const signalReady = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const push = (e: Event) => {
    buffer.push(e);
    signalReady();
  };

  let streamDone = false;
  let streamError: unknown = null;
  let assistantText = '';

  let resolvedModel;
  try {
    resolvedModel = resolveModel(model);
  } catch (err) {
    log.error('model resolution failed', { model, err: String(err) });
    await recordRun(
      buildRecord({
        model,
        language,
        sessionId,
        historyLen,
        message,
        toolCalls: [],
        sermonsRead: [],
        response: '',
        durationMs: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        status: 'error',
        error: String(err),
      }),
    );
    yield { type: 'error', error: String(err) };
    return;
  }

  const result = streamText({
    model: resolvedModel,
    system: KK_ASSISTANT_SYSTEM_PROMPT,
    messages,
    tools: { listSermons, readSermon },
    stopWhen: stepCountIs(MAX_STEPS),
    abortSignal: signal,
    ...(TELEMETRY_ENABLED && {
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'sampark-briefing',
        metadata: { language, sessionId, model },
      },
    }),
  });

  const heartbeat = setInterval(() => {
    push({ type: 'heartbeat', elapsed_ms: Date.now() - started });
  }, HEARTBEAT_MS);

  const reader = (async () => {
    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            if (part.text) {
              assistantText += part.text;
              push({ type: 'text', text: part.text });
            }
            break;

          case 'tool-call':
            log.info('model tool-call', {
              name: part.toolName,
              input: part.input,
            });
            toolCalls.push({ name: part.toolName, input: part.input });
            if (part.toolName === 'readSermon') {
              const fn = (part.input as { filename?: string })?.filename;
              if (fn) sermonsRead.push(fn);
            }
            push({ type: 'tool_use', name: part.toolName, input: part.input });
            break;

          case 'tool-result':
            log.info('model tool-result', { name: part.toolName, ok: true });
            push({ type: 'tool_result', name: part.toolName, ok: true });
            break;

          case 'tool-error':
            log.error('model tool-error', {
              name: part.toolName,
              error: String(part.error),
            });
            push({
              type: 'tool_result',
              name: part.toolName,
              ok: false,
              error: String(part.error),
            });
            break;

          case 'finish':
            sessions.set(sessionId, [
              ...messages,
              { role: 'assistant', content: assistantText },
            ]);
            usageIn = part.totalUsage.inputTokens ?? 0;
            usageOut = part.totalUsage.outputTokens ?? 0;
            runStatus = 'success';
            log.info('briefing finish', {
              sessionId,
              duration_ms: Date.now() - started,
              input_tokens: usageIn,
              output_tokens: usageOut,
              text_chars: assistantText.length,
            });
            push({
              type: 'result',
              session_id: sessionId,
              duration_ms: Date.now() - started,
              input_tokens: usageIn,
              output_tokens: usageOut,
            });
            break;

          case 'error':
            log.error('stream error event', { err: String(part.error) });
            runError = String(part.error);
            push({ type: 'error', error: String(part.error) });
            break;

          default:
            log.debug('stream part (unhandled)', { type: part.type });
            break;
        }
      }
    } catch (err) {
      log.error('fullStream iteration threw', { err: String(err) });
      streamError = err;
      runError = String(err);
    } finally {
      streamDone = true;
      clearInterval(heartbeat);
      signalReady();
    }
  })();

  try {
    while (!streamDone || buffer.length > 0) {
      if (buffer.length > 0) {
        yield buffer.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    if (streamError) {
      yield { type: 'error', error: String(streamError) };
    }
  } finally {
    clearInterval(heartbeat);
    await reader.catch(() => {});
    await recordRun(
      buildRecord({
        model,
        language,
        sessionId,
        historyLen,
        message,
        toolCalls,
        sermonsRead,
        response: assistantText,
        durationMs: Date.now() - started,
        inputTokens: usageIn,
        outputTokens: usageOut,
        status: runStatus,
        error: runError,
      }),
    );
  }
}

type BuildRecordArgs = {
  model: string;
  language: string;
  sessionId: string;
  historyLen: number;
  message: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  sermonsRead: string[];
  response: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  status: 'success' | 'error';
  error?: string;
};

function buildRecord(a: BuildRecordArgs): RunRecord {
  return {
    id: newRunId(),
    timestamp: new Date().toISOString(),
    sessionId: a.sessionId,
    params: {
      model: a.model,
      provider: inferProvider(a.model),
      language: a.language,
      maxSteps: MAX_STEPS,
      systemPromptHash: hashPrompt(KK_ASSISTANT_SYSTEM_PROMPT),
    },
    input: {
      message: a.message,
      historyLen: a.historyLen,
    },
    toolCalls: a.toolCalls,
    sermonsRead: a.sermonsRead,
    response: a.response,
    metrics: {
      durationMs: a.durationMs,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      responseChars: a.response.length,
      toolCallCount: a.toolCalls.length,
    },
    status: a.status,
    error: a.error,
  };
}

export function clearSession(sessionId: string): void {
  log.info('session cleared', { sessionId });
  sessions.delete(sessionId);
}
