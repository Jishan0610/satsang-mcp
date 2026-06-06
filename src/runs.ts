import { appendFile, mkdir, readFile } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { resolve, dirname } from 'path';
import { log } from './logger.js';

const RUNS_PATH = resolve(process.cwd(), 'data/runs.jsonl');

/**
 * A single briefing run, captured for offline evaluation and model comparison.
 * One JSON object per line in data/runs.jsonl (append-only).
 */
export type RunRecord = {
  id: string;
  timestamp: string;
  sessionId: string;

  // --- model parameters (the knobs you vary across evals) ---
  params: {
    model: string;
    provider: string;
    language: string;
    maxSteps: number;
    systemPromptHash: string;
  };

  // --- input ---
  input: {
    message: string;
    historyLen: number;
  };

  // --- agent activity ---
  toolCalls: Array<{ name: string; input: unknown }>;
  sermonsRead: string[];

  // --- output ---
  response: string;

  // --- metrics ---
  metrics: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    responseChars: number;
    toolCallCount: number;
  };

  // --- status ---
  status: 'success' | 'error';
  error?: string;
};

export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 12);
}

export function inferProvider(model: string): string {
  if (model.includes('/')) return model.split('/')[0];
  if (model.startsWith('claude-')) return 'anthropic';
  if (
    model.startsWith('gpt-') ||
    model.startsWith('o1') ||
    model.startsWith('o3') ||
    model.startsWith('o4')
  )
    return 'openai';
  if (model.startsWith('gemini-')) return 'google';
  return 'unknown';
}

export function newRunId(): string {
  return randomUUID();
}

export async function recordRun(record: RunRecord): Promise<void> {
  try {
    await mkdir(dirname(RUNS_PATH), { recursive: true });
    await appendFile(RUNS_PATH, JSON.stringify(record) + '\n', 'utf-8');
    log.info('run recorded', {
      id: record.id,
      model: record.params.model,
      status: record.status,
    });
  } catch (err) {
    // Never let eval logging break a briefing.
    log.error('failed to record run', { err: String(err) });
  }
}

/** Read all recorded runs (for eval scripts / inspection). */
export async function loadRuns(): Promise<RunRecord[]> {
  try {
    const raw = await readFile(RUNS_PATH, 'utf-8');
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as RunRecord);
  } catch {
    return [];
  }
}
