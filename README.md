# Bawwab — Self-Hosted AI Gateway

> **باب** (Arabic: "Gateway") — Route, optimize, and manage AI providers from your own machine.

Bawwab is an **open-source, self-hosted AI Gateway** that unifies access to 40+ AI providers through a single OpenAI-compatible API. Features intelligent routing, automatic fallback, token optimization, real-time health monitoring, and a modern dark-mode dashboard.

**Your API keys stay on your machine. Always.**

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Step-by-Step Tutorial](#step-by-step-tutorial)
- [Custom Providers](#custom-providers)
- [Dashboard Guide](#dashboard-guide)
- [API Reference](#api-reference)
- [Connect Your AI Tool](#connect-your-ai-tool)
- [Supported Providers](#supported-providers)
- [Architecture](#architecture)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [License](#license)

---

## Features

| Feature | Description |
|---------|-------------|
| **Unified API** | Single OpenAI-compatible endpoint for all providers |
| **Intelligent Routing** | Auto-select best provider by health, latency, cost |
| **Auto Fallback** | Primary fails? Automatically tries 2 fallback providers |
| **Custom Providers** | Add any provider via JSON config or dashboard UI |
| **Token Optimizer** | 3-level compression + deduplication + semantic chunking |
| **Health Monitoring** | Real-time provider health checks every 30s |
| **Rate Limiting** | Per-API-key rate limits + monthly quotas |
| **Dark Dashboard** | Modern monochrome UI served from same port |
| **Zero Cloud** | Runs entirely on your machine — no external deploy |

---

## Quick Start

### Requirements

- **Node.js 18+**
- **npm**

### 1. Clone & Install

```bash
git clone https://github.com/kentanghub/bawwab.git
cd bawwab
npm install
```

### 2. Configure

Run the interactive wizard:

```bash
npm run setup
```

Or manually create `api/.env`:

```env
PORT=3001
HOST=0.0.0.0
NODE_ENV=production
JWT_SECRET=your-secret-here
ADMIN_API_KEY=bawwab_your-admin-key

# Optional: add provider API keys
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
DEEPSEEK_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
TAVILY_API_KEY=tvly-...
JINA_API_KEY=jina_...
```

### 3. Build & Run

```bash
npm run build
npm start
```

Open **http://localhost:3001** — dashboard and API run on the same port.

---

## Step-by-Step Tutorial

### Step 1: Start Bawwab

```bash
cd bawwab
npm start
```

You should see:

```
🚪 Bawwab Gateway starting...
🗄️ Database initialized
📦 Loaded 11 providers
💓 Health monitor started
✅ Bawwab Gateway ready
🚀 Bawwab API running on http://0.0.0.0:3001
```

### Step 2: Open Dashboard

Go to **http://localhost:3001**

You'll see:
- Stats cards (requests, tokens, cost, latency)
- Hourly usage charts
- Provider health status

### Step 3: Set Admin Key

1. Click **Settings** in the sidebar
2. Enter your `ADMIN_API_KEY` from `.env`
3. Click **Save**

This unlocks provider management.

### Step 4: Test the API

```bash
# List all models
curl http://localhost:3001/v1/models

# Chat completion (uses intelligent routing)
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-admin-api-key" \
  -d '{
    "model": "kr/claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello, Bawwab!"}]
  }'

# Generate image
curl http://localhost:3001/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-admin-api-key" \
  -d '{
    "model": "poll/flux",
    "prompt": "A futuristic gateway"
  }'
```

### Step 5: Add a Custom Provider (Dashboard)

1. Go to **Providers** → click **Add Provider**
2. Fill in:
   - **ID**: `myai`
   - **Name**: `My Custom AI`
   - **Base URL**: `https://api.myai.com/v1`
   - **Auth Type**: Bearer
   - **Model ID**: `my-model`
3. Click **Add Provider**

Set the API key in `.env` as `MYAI_API_KEY=sk-...` and restart.

### Step 6: Add a Custom Provider (JSON Config)

Create `api/config/providers.json`:

```json
{
  "providers": [
    {
      "id": "myai",
      "alias": "my",
      "name": "My Custom AI",
      "type": "apikey",
      "baseUrl": "https://api.myai.com/v1",
      "authType": "bearer",
      "models": [
        {
          "id": "my-model",
          "name": "My Model",
          "contextWindow": 128000,
          "supportsStreaming": true,
          "supportsTools": true,
          "costPer1kInput": 0.001,
          "costPer1kOutput": 0.003
        }
      ],
      "capabilities": ["llm"]
    }
  ]
}
```

Restart Bawwab — the provider loads automatically.

### Step 7: Connect Your AI Tool

Configure any OpenAI-compatible tool:

```
Base URL:   http://localhost:3001/v1
API Key:    your-admin-api-key
Model:      kr/claude-sonnet-4   (or any available model)
```

**Supported tools:** Claude Code, Cursor, Cline, Continue, Codex, and any OpenAI-compatible client.

---

## Custom Providers

### Via Dashboard (easiest)

Go to **Providers** → **Add Provider** and fill the form.

### Via JSON Config

Place a `providers.json` file in one of these locations:
- `api/config/providers.json`
- `providers.json` (working directory)
- Path set by `PROVIDERS_CONFIG_PATH` env var

Example: [api/config/providers.json.example](api/config/providers.json.example)

### Via Environment Variable

Set `PROVIDERS_CONFIG_PATH=/path/to/providers.json`

---

## Dashboard Guide

| Page | Path | What you can do |
|------|------|-----------------|
| **Dashboard** | `/` | Real-time metrics, charts, usage stats |
| **Image Gen** | `/image-gen` | Generate images via Pollinations AI |
| **Compare** | `/compare` | Side-by-side model comparison |
| **Embeddings** | `/embeddings` | Convert text to vector embeddings |
| **Providers** | `/providers` | View, toggle, add providers |
| **Logs** | `/logs` | Request history with latency & tokens |
| **Settings** | `/settings` | Set admin key, token optimizer config |

---

## API Reference

### Chat Completions

```bash
POST /v1/chat/completions
Content-Type: application/json
x-api-key: your-key

{
  "model": "kr/claude-sonnet-4",
  "messages": [{"role": "user", "content": "Hello!"}],
  "temperature": 0.7,
  "stream": false
}
```

**Model aliases:** Use `kr/`, `oa/`, `gem/`, `ds/`, `anth/` prefixes or full IDs.

**Combo mode:** `combo/gpt4o+claude-sonnet-4` sends to multiple providers in parallel.

### Image Generation

```bash
POST /v1/images/generations
{
  "model": "poll/flux",
  "prompt": "A cyberpunk city",
  "size": "1024x1024"
}
```

### Embeddings

```bash
POST /v1/embeddings
{
  "model": "oa/text-embedding-3-small",
  "input": "Hello world"
}
```

### Web Search

```bash
POST /v1/web/search
{
  "query": "latest AI news"
}
```

### Web Fetch

```bash
POST /v1/web/fetch
{
  "url": "https://example.com/article"
}
```

### Audio

```bash
# Text to Speech
POST /v1/audio/speech
{ "model": "oa/tts-1", "input": "Hello", "voice": "alloy" }

# Speech to Text
POST /v1/audio/transcriptions
{ "model": "oa/whisper-1", "file": "..." }
```

### Admin Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/admin/providers` | POST | Admin key | Add provider |
| `/v1/admin/providers/:id/toggle` | PATCH | Admin key | Enable/disable |
| `/v1/admin/providers/:id` | DELETE | Admin key | Remove provider |
| `/v1/admin/metrics` | GET | Admin key | Get stats |
| `/v1/admin/logs` | GET | Admin key | Get logs |

---

## Connect Your AI Tool

### Claude Code

```bash
claude config set apiUrl http://localhost:3001/v1
claude config set apiKey your-admin-api-key
```

### Cursor

1. Settings → AI Provider → OpenAI Compatible
2. Base URL: `http://localhost:3001/v1`
3. API Key: `your-admin-api-key`

### Cline (VS Code)

1. Settings → API Provider → OpenAI Compatible
2. Base URL: `http://localhost:3001/v1`
3. API Key: `your-admin-api-key`

### Generic

```
Base URL:   http://localhost:3001/v1
API Key:    your-admin-api-key
```

---

## Supported Providers

### Built-in (11 providers)

| Provider | Alias | Type | Capabilities |
|----------|-------|------|--------------|
| **Kiro AI** | `kr` | Free | LLM |
| **OpenCode** | `oc` | Free | LLM |
| **OpenRouter** | `or` | API Key | LLM, Embedding |
| **GLM Coding** | `glm` | API Key | LLM |
| **DeepSeek** | `ds` | API Key | LLM |
| **Gemini** | `gem` | API Key | LLM, Embedding, Image, TTS, STT |
| **OpenAI** | `oa` | API Key | LLM, Embedding, Image, TTS, STT |
| **Pollinations** | `poll` | Free | Image |
| **Jina AI** | `jn` | API Key | Embedding, Web Fetch |
| **Tavily** | `tv` | API Key | Web Search |
| **Anthropic** | `anth` | API Key | LLM, Image-to-Text |

### Custom Providers

Add unlimited custom providers via JSON config or dashboard. Bawwab auto-detects model compatibility and routes intelligently.

---

## Architecture

```
┌─────────────────┐
│   Your Browser  │
│  localhost:3001 │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│        Bawwab Gateway               │
│  ┌───────────────────────────────┐  │
│  │  Static Dashboard (React)     │  │
│  │  /  → index.html              │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  API (Fastify)                │  │
│  │  /v1/chat/completions         │  │
│  │  /v1/images/generations       │  │
│  │  /v1/admin/providers          │  │
│  └───────────────────────────────┘  │
│         │                           │
│    Intelligent Router               │
│    ├─ Health scoring                │
│    ├─ Latency tracking              │
│    ├─ Cost optimization             │
│    └─ Auto fallback (max 2)         │
└─────────┬───────────────────────────┘
          │
    ┌─────┴─────┬─────────┬──────────┐
    ▼           ▼         ▼          ▼
 Provider A  Provider B  ...    Provider N
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | random | JWT signing secret |
| `ADMIN_API_KEY` | Yes | — | Admin API key for dashboard |
| `PORT` | No | 3001 | Server port |
| `HOST` | No | 0.0.0.0 | Bind address |
| `NODE_ENV` | No | development | production / development |
| `LOG_LEVEL` | No | info | debug, info, warn, error |
| `DB_PATH` | No | `./data/bawwab.db` | SQLite database path |
| `RATE_LIMIT` | No | 60 | Requests per minute per key |
| `PROVIDERS_CONFIG_PATH` | No | — | Custom providers JSON path |
| `{PROVIDER}_API_KEY` | No | — | Provider-specific API keys |

---

## Troubleshooting

### Port already in use

```bash
# Use different port
PORT=3002 npm start
```

### Build errors

```bash
rm -rf node_modules api/node_modules dashboard/node_modules
rm -rf api/dist dashboard/dist
npm install
npm run build
```

### Dashboard toggle not working

Make sure you've set the **Admin API Key** in **Settings**. The key must match `ADMIN_API_KEY` in your `.env`.

### Provider returns error

1. Check health: `curl /v1/providers/health`
2. Verify API key in `.env`
3. Check provider status page

---

## Security

Bawwab is designed with security in mind for self-hosted deployments:

- **API keys hashed** with SHA-256 before storage
- **No upstream keys exposed** in responses or logs
- **SQL injection safe** — parameterized queries throughout
- **Rate limiting** per API key + monthly quotas
- **Input validation** on all provider configs (URL validation, ID sanitization)
- **CORS restricted** in production mode
- **Admin endpoints require** either JWT or admin API key
- **Request body limit** capped at 10MB
- **Graceful shutdown** handles SIGTERM/SIGINT properly

**⚠️ Important:** Keep your `.env` file secure. Do not commit it. It's already in `.gitignore`.

---

## License

MIT License — see [LICENSE](LICENSE)

---

Built with 💚 by the Bawwab team.
