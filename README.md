# Sampark Setu

A pre-meeting briefing tool for karyakartas (satsang volunteers). Describe the person you're about to meet, and the app returns a tight, actionable briefing grounded in Pujya Swamiji's teachings from the `Ghostis/` sermon transcripts.

> **POC** — prioritizes working code over production patterns.

---

## How It Works

```
Profile + Description → streamText (agentic loop) → 3-section briefing
```

A model agent receives the karyakarta's description, autonomously calls `listSermons` then `readSermon` on the Gujarati transcripts it judges relevant, and writes a briefing in a strict 3-section format. There is **no pre-filtering** — the agent sees the full filename list and chooses what to read, so a brief mention in a sermon (not its main topic) can still be surfaced.

The briefing has exactly three sections:

1. **How to Approach** — psychological read of the person (≤100 words)
2. **Relevant Teachings from Guruhari** — exactly 2 verbatim Gujarati passages (Sutra + one of Prasang/Analogy/Direct)
3. **The Connection** — how each teaching connects, in plain language, plus one push-back contingency

---

## Stack

- **Runtime:** Node.js + TypeScript (`tsx`)
- **AI:** [Vercel AI SDK](https://ai-sdk.dev) (`ai`) with multi-provider support
- **Server:** [Hono](https://hono.dev)
- **Observability (optional):** Langfuse via OpenTelemetry

### Supported models

Pick any model from the UI dropdown, or pass `model` in the API request. Provider is auto-detected by prefix.

| Provider | Examples | Env key |
|---|---|---|
| Anthropic | `claude-sonnet-4-6` (default), `claude-opus-4-8`, `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-5.5`, `gpt-5.4-mini`, `o4-mini` | `OPENAI_API_KEY` |
| Google | `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-2.5-pro` | `GOOGLE_GENERATIVE_AI_API_KEY` |

You only need a key for the providers you actually use.

---

## Setup

```bash
npm install
cp .env.example .env   # then fill in at least one provider key
```

`.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
# optional: OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY
```

---

## Running

```bash
npm run dev          # tsx src/server.ts → http://localhost:8000
```

Open [http://localhost:8000](http://localhost:8000), describe the person, pick a language + model, and generate.

| Script | Purpose |
|---|---|
| `npm run dev` | Run the server with `tsx` |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |

### Environment variables

| Var | Default | Purpose |
|---|---|---|
| `SAMPARK_PORT` | `8000` | Server port |
| `SAMPARK_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_BASE_URL` | — | Enables Langfuse tracing when all set |

---

## API

### `POST /api/brief`

Streams the briefing as newline-delimited JSON (NDJSON).

```json
{ "message": "17-year-old, very independent...", "language": "english", "model": "claude-sonnet-4-6", "session_id": "optional-uuid" }
```

Event types: `start`, `tool_use`, `tool_result`, `text`, `heartbeat`, `result`, `error`.
The `result` event returns a `session_id` — pass it back to continue the same conversation.

### `DELETE /api/session/:id`

Clears an in-memory session.

### `GET /healthz`

Liveness check.

---

## Project Structure

```
satsang-mcp/
├── Ghostis/                # Gujarati sermon transcripts (.txt) — the only files the agent reads
├── data/
│   ├── profiles.json       # 50 profiles
│   └── runs.jsonl          # eval logs (gitignored, created at runtime)
├── public/
│   └── index.html          # chat UI
├── src/
│   ├── tools.ts            # listSermons + readSermon
│   ├── agent.ts            # system prompt + step limit
│   ├── models.ts           # multi-provider model resolver
│   ├── pipeline.ts         # streamBriefing() agentic loop + session store + run recording
│   ├── runs.ts             # eval run records
│   ├── logger.ts           # structured logger
│   └── server.ts           # Hono routes
├── CLAUDE.md               # agent/contributor context
├── sampark-setu-brief.md   # full product spec + 50 profiles
└── .cursor/instructions.md # implementation reference
```

---

## Evaluation

Every briefing run is appended to `data/runs.jsonl` (one JSON object per line) capturing model params, input, which sermons were read, the full response, token usage, and latency. Use it to compare models on the same input:

```bash
cat data/runs.jsonl | jq '{model: .params.model, ms: .metrics.durationMs, out_tokens: .metrics.outputTokens, sermons: (.sermonsRead | length), status}'
```

---

## Inviolable Rules

- `Ghostis/` files are read verbatim, UTF-8, never normalized or summarized
- Briefing output is always exactly 3 sections, exactly 2 teachings (≥1 Sutra)
- Verbatim Gujarati is never truncated or paraphrased — and stays in Gujarati script regardless of response language
- English in → English out; Gujarati in → Gujarati out; Hindi in → Hindi out; never mixed
- No partial output — if no good match, the agent returns the fallback string verbatim
