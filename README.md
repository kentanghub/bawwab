# Bawwab — Intelligent AI Gateway

> **باب** (Arabic: "Gateway") — The smarter way to route, optimize, and manage AI providers.

Bawwab is an open-source AI Gateway that improves upon existing solutions with intelligent routing, advanced token optimization, real-time health monitoring, and a modern dashboard.

## 📑 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Running Bawwab](#running-bawwab)
- [Tutorial: First Run](#-tutorial-first-run)
  - [Step 1: Start Bawwab](#step-1-start-bawwab)
  - [Step 2: Open Dashboard](#step-2-open-dashboard)
  - [Step 3: Check Health](#step-3-check-health)
  - [Step 4: Configure Providers](#step-4-configure-providers)
  - [Step 5: Test API](#step-5-test-api)
  - [Step 6: Connect AI Tool](#step-6-connect-ai-tool)
  - [Step 7: Monitor in Dashboard](#step-7-monitor-in-dashboard)
- [Connect Your AI Tool](#-connect-your-ai-tool)
- [Supported Providers](#-supported-providers)
- [Architecture](#-architecture)
- [Development](#-development)
- [API Reference](#-api-reference)
- [Environment Variables](#-environment-variables)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

## ✨ Features

### 🧠 Intelligent Routing
- Automatic provider selection based on health, latency, cost, and capabilities
- Smart fallback when providers fail
- Combo model support (e.g., `combo/gpt4+claude`)

### 🗜️ Advanced Token Saver
- 3 compression levels (light, medium, aggressive)
- Tool result deduplication
- Semantic chunking
- Sliding window context management
- Base64 image truncation

### 💓 Real-time Health Monitoring
- Automatic health checks every 30 seconds
- Latency tracking
- Success rate calculation
- Auto-disable unhealthy providers

### 📊 Modern Dashboard
- Real-time metrics via WebSocket
- Provider health visualization
- Request logs
- Token optimizer configuration

### 🔌 Plugin System
- Easy provider addition via JSON config
- Hot-swappable providers
- Support for 40+ providers out of the box

## 🚀 Quick Start (Self-Hosted)

Bawwab is designed to run **locally on your own machine**. No cloud deployment required — your API keys stay private.

### Prerequisites

- **Node.js 18+** (check with `node --version`)
- **npm**

```bash
node --version
```

### 1. Clone & Install

```bash
git clone https://github.com/kentanghub/bawwab.git
cd bawwab
npm install
```

### 2. Configure

Run the interactive setup wizard:

```bash
npm run setup
```

Or manually create `api/.env`:

```env
PORT=3001
HOST=0.0.0.0
NODE_ENV=production
JWT_SECRET=your-secret
ADMIN_API_KEY=your-admin-key
OPENAI_API_KEY=sk-...        # optional
GEMINI_API_KEY=AIza...       # optional
DEEPSEEK_API_KEY=sk-...      # optional
ANTHROPIC_API_KEY=sk-ant-... # optional
TAVILY_API_KEY=tvly-...      # optional
JINA_API_KEY=jina_...        # optional
```

### 3. Build & Run

```bash
npm run build
npm start
```

Open your browser: **http://localhost:3001** 🎉

The React dashboard is served directly from the backend — no separate port needed.

---

## 📖 Tutorial: First Run

This tutorial will guide you through your first Bawwab setup from start to finish.

### Step 1: Start Bawwab

Open your terminal and run:

```bash
cd bawwab
npm start
```

You should see output like:

```
╔═══════════════════════════════════════════════╗
║                                               ║
║   🚪 Bawwab — Intelligent AI Gateway          ║
║                                               ║
╚═══════════════════════════════════════════════╝

📦 Building Bawwab for first run...
🚀 Starting API Gateway...
🎨 Starting Dashboard...

✅ Bawwab is running!

   🌐 Dashboard:    http://localhost:20128
   🔌 API:          http://localhost:20128/v1
   📖 API Docs:     http://localhost:20128/docs

   Press Ctrl+C to stop
```

### Step 2: Open Dashboard

Open your browser and go to: **`http://localhost:20128`**

You will see:
- **Stats cards** showing total requests, tokens, cost, and latency
- **Charts** with requests over time
- **Provider health** status list

### Step 3: Check Health

Verify Bawwab is running correctly:

```bash
curl http://localhost:20128/health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "services": {
    "cache": false,
    "healthMonitor": true
  }
}
```

### Step 4: Configure Providers

1. Go to **Dashboard** → click **"Providers"** in the sidebar
2. You will see a list of built-in providers:
   - Kiro AI (free, no key needed)
   - OpenCode Free (free, no key needed)
   - OpenRouter (needs API key)
   - Anthropic (needs API key)
   - etc.

3. **Enable providers** by clicking the toggle button
4. For API key providers, add your key to `api/.env` and restart

### Step 5: Test API

Test with a simple chat completion:

```bash
# List available models
curl http://localhost:20128/v1/models

# Chat with a model (using free Kiro provider)
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kr/claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello, Bawwab!"}]
  }'
```

Expected response:
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "kr/claude-sonnet-4",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }]
}
```

### Step 6: Connect AI Tool

Now connect your favorite AI coding tool:

#### Claude Code

```bash
# Set API URL
claude config set apiUrl http://localhost:20128/v1

# Set API key (from your .env)
claude config set apiKey your-admin-api-key

# Start coding
claude
```

#### Cursor IDE

1. Open Cursor → Settings → AI Provider
2. Select **"OpenAI Compatible"**
3. Base URL: `http://localhost:20128/v1`
4. API Key: `your-admin-api-key`
5. Model: `kr/claude-sonnet-4` or any available model

#### Cline (VS Code Extension)

1. Open VS Code → Cline Settings
2. API Provider: **"OpenAI Compatible"**
3. Base URL: `http://localhost:20128/v1`
4. API Key: `your-admin-api-key`

#### Generic OpenAI-Compatible Tool

```
Endpoint: http://localhost:20128/v1
API Key: your-admin-api-key
Model: kr/claude-sonnet-4
```

### Step 7: Monitor in Dashboard

1. Go back to `http://localhost:20128`
2. Click **"Dashboard"** in the sidebar
3. Watch real-time metrics:
   - Requests count increases
   - Token usage updates
   - Cost tracking
   - Provider health status

4. Click **"Logs"** to see detailed request history

---

## 📝 Connect Your AI Tool

After Bawwab is running, configure your AI coding tool:

```
Endpoint: http://localhost:20128/v1
API Key: [your-admin-api-key from .env]
Model: kr/claude-sonnet-4
```

### Supported Tools

| Tool | Setup Guide |
|------|-------------|
| Claude Code | `claude config set apiUrl http://localhost:20128/v1` |
| OpenClaw | Settings → API → Custom Endpoint |
| Codex (OpenAI) | `codex --api-url http://localhost:20128/v1` |
| Cursor | Settings → AI Provider → OpenAI Compatible |
| Cline | Settings → API Provider → Custom |
| Antigravity | Settings → API → Custom URL |
| Copilot | GitHub Copilot settings |
| Continue | config.json → apiBase |
| Any OpenAI-compatible | Use endpoint above |

## 🌐 Supported Providers

### Free Providers (No API Key)

| Provider | Alias | Models | Features |
|----------|-------|--------|----------|
| **Kiro AI** | `kr` | Claude Sonnet 4 | Free unlimited |
| **OpenCode Free** | `oc` | Various | No auth required |

### API Key Providers

| Provider | Alias | Pricing | Free Tier |
|----------|-------|---------|-----------|
| **OpenRouter** | `or` | Pay-per-use | 27+ free models, 200 req/day |
| **Anthropic** | `anth` | $3-15/1M tokens | $5 trial |
| **OpenAI** | `oa` | $0.15-75/1M tokens | $5 trial |
| **DeepSeek** | `ds` | $0.14-2.19/1M tokens | 500M tokens free |
| **Gemini** | `gem` | $0.15-10/1M tokens | 1M tokens/day free |
| **GLM** | `glm` | $1-3/1M tokens | Trial credits |

## 🏗️ Architecture

```
User Browser → http://localhost:20128
                    │
                    ├── / → Dashboard (Vite + React)
                    └── /v1/* → API Gateway (Fastify)
                                    │
                                    ├── Intelligent Router
                                    ├── Token Optimizer
                                    ├── Health Monitor
                                    └── Cache Manager
```

## 🛠️ Development

```bash
# Start API in dev mode (hot reload)
npm run dev:api

# Start Dashboard in dev mode (another terminal)
npm run dev:dashboard

# Build for production
npm run build

# Run tests
npm test
```

## 📖 API Reference

### Chat Completions

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "kr/claude-sonnet-4",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "temperature": 0.7,
    "max_tokens": 1000,
    "stream": false
  }'
```

### List Models

```bash
curl http://localhost:20128/v1/models
```

### Health Check

```bash
curl http://localhost:20128/health
```

### Provider Status

```bash
curl http://localhost:20128/v1/providers
curl http://localhost:20128/v1/providers/health
```

## 📊 Dashboard Pages

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | `/` | Real-time metrics & charts |
| Providers | `/providers` | Manage AI providers |
| Logs | `/logs` | Request history |
| Settings | `/settings` | Token optimizer config |

## 🛡️ Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | — | Secret for JWT tokens |
| `ADMIN_API_KEY` | Yes | — | Admin API key |
| `PORT` | No | 3001 | API port |
| `REDIS_URL` | No | — | Redis connection (optional) |
| `RATE_LIMIT` | No | 100 | Requests per minute |

## 🔧 Troubleshooting

### Port already in use

```bash
# Find process using port 20128
lsof -i :20128

# Kill it
kill -9 <PID>

# Or use different port
PORT=3002 npm start
```

### Build errors

```bash
# Clean and rebuild
rm -rf node_modules api/node_modules dashboard/node_modules
rm -rf api/dist dashboard/dist
npm install
npm run build
```

### Provider connection issues

1. Check provider health: `curl http://localhost:20128/v1/providers/health`
2. Verify API key in `api/.env`
3. Check provider status page

### Dashboard not loading

1. Ensure build completed: `npm run build`
2. Check browser console for errors
3. Try clearing browser cache

## 📝 License

MIT License — see [LICENSE](LICENSE)

## 🤝 Contributing

Contributions welcome! Please read our [Contributing Guide](CONTRIBUTING.md).

---

Built with 💚 by the Bawwab team.
