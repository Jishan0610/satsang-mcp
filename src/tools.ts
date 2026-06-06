import { tool } from 'ai';
import { z } from 'zod';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { resolve, basename, join } from 'path';
import { log } from './logger.js';

const GHOSTIS_DIR = resolve(process.cwd(), 'Ghostis');

if (!existsSync(GHOSTIS_DIR)) {
  log.warn('Ghostis/ directory not found at startup', { path: GHOSTIS_DIR, cwd: process.cwd() });
} else {
  log.info('Ghostis/ directory ready', { path: GHOSTIS_DIR });
}

export const listSermons = tool({
  description:
    'List all available Goshthi sermon .txt filenames. Call this first before reading any file. ' +
    'Returns a plain newline-separated list of filenames. Does not return file contents.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const files = readdirSync(GHOSTIS_DIR)
        .filter((f) => f.endsWith('.txt'))
        .sort();
      log.info('tool listSermons', { count: files.length });
      if (files.length === 0) {
        log.warn('Ghostis/ has no .txt files', { path: GHOSTIS_DIR });
      }
      return files.join('\n');
    } catch (err) {
      log.error('tool listSermons failed', { err: String(err) });
      throw err;
    }
  },
});

export const readSermon = tool({
  description:
    'Read the full Gujarati text of a single Goshthi sermon file. ' +
    'Use a filename returned by listSermons. Returns complete file contents — never truncated. ' +
    'Call once per file; do not call for files you do not need.',
  inputSchema: z.object({
    filename: z.string().describe('Filename returned by listSermons'),
  }),
  execute: async ({ filename }) => {
    try {
      const safeName = basename(filename);
      if (!safeName.endsWith('.txt')) {
        throw new Error(`Invalid sermon filename: ${filename}`);
      }
      const fullPath = resolve(join(GHOSTIS_DIR, safeName));
      if (!fullPath.startsWith(GHOSTIS_DIR)) {
        throw new Error(`Path escapes Ghostis/: ${filename}`);
      }
      if (!existsSync(fullPath)) {
        throw new Error(`Sermon not found: ${safeName}`);
      }
      const text = readFileSync(fullPath, 'utf-8');
      log.info('tool readSermon', { file: safeName, chars: text.length });
      return text;
    } catch (err) {
      log.error('tool readSermon failed', { filename, err: String(err) });
      throw err;
    }
  },
});
