# Bawwab — Intelligent AI Gateway

> **باب** (Arabic: "Gateway") — The smarter way to route, optimize, and manage AI providers.

Bawwab is an open-source AI Gateway that improves upon existing solutions with intelligent routing, advanced token optimization, real-time health monitoring, and a modern dashboard.

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

## 🚀 Quick Start (Local Installation)

### Prerequisites
- Node.js 18+ (check with `node --version`)

### Option 1: Clone & Run (Recommended)

```bash
# Clone the repo
git clone https://github.com/kentanghub/bawwab.git
cd bawwab

# Install dependencies
npm install

# Configure (copy and edit .env)
cp api/.env.example api/.env
# Edit api/.env and add your API keys

# Build & Start
npm run build
npm start
```

🎉 **Dashboard opens at** `http://localhost:20128`

### Option 2: Global Install via npm

```bash
# Install globally
npm install -g bawwab

# Run anywhere
bawwab
```

🎉 **Dashboard opens at** `http://localhost:20128`

### Option 3: Using npx (No Install)

```bash
npx bawwab
```

## 📝 Connect Your AI Tool

After Bawwab is running, configure your AI coding tool:

```
Endpoint: http://localhost:20128/v1
API Key: [your-admin-api-key from .env]
Model: kr/claude-sonnet-4
```

### Supported Tools
- Claude Code
- OpenClaw
- Codex (OpenAI)
- Cursor
- Cline
- Antigravity
- Copilot
- Continue
- Any OpenAI-compatible tool

## 🌐 Supported Providers

### Free Providers (No API Key)
- **Kiro AI** — Free Claude unlimited
- **OpenCode Free** — No auth required

### API Key Providers
- **OpenRouter** — 27+ free models, 200 req/day
- **Anthropic** — Claude Sonnet/Opus
- **OpenAI** — GPT-4o, GPT-4o-mini
- **DeepSeek** — DeepSeek Chat/Reasoner
- **Gemini** — Gemini 2.5 Pro/Flash
- **GLM** — GLM 4.5

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
# Start API in dev mode
npm run dev:api

# Start Dashboard in dev mode (another terminal)
npm run dev:dashboard

# Build for production
npm run build
```

## 📖 API Endpoints

### Chat Completions
```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "kr/claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello!"}]
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

## 📝 License

MIT License — see [LICENSE](LICENSE)

## 🤝 Contributing

Contributions welcome! Please read our [Contributing Guide](CONTRIBUTING.md).

---

Built with 💚 by the Bawwab team.
