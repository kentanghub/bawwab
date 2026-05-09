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

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│           DASHBOARD (Vite + React)          │
│  Real-time metrics · Provider health · Logs  │
└─────────────────────┬───────────────────────┘
                      │ WebSocket / HTTP
┌─────────────────────▼───────────────────────┐
│        API GATEWAY (Fastify + TypeScript)   │
│  ┌─────────┐ ┌──────────┐ ┌─────────────┐  │
│  │  Auth   │ │  Cache   │ │   Router    │  │
│  │ (JWT)   │ │ (Redis)  │ │(Intelligent)│  │
│  └─────────┘ └──────────┘ └─────────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌─────────────┐  │
│  │  Token  │ │  Plugin  │ │   Health    │  │
│  │  Saver  │ │  Manager │ │   Monitor   │  │
│  │(Advanced)│ │(Hot-swap)│ │ (Auto-check)│  │
│  └─────────┘ └──────────┘ └─────────────┘  │
└─────────────────────┬───────────────────────┘
                      │ HTTP/SSE
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   [Provider A] [Provider B] [Provider C]
   Claude/GPT   GLM/DeepSeek  Free Tier
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Redis (optional, falls back to in-memory)

### Installation

```bash
# Clone
git clone https://github.com/kentanghub/bawwab.git
cd bawwab

# Install dependencies
npm install

# Configure
cp api/.env.example api/.env
# Edit api/.env with your API keys

# Run development
npm run dev
```

### Services
- **API Gateway**: http://localhost:3001
- **Dashboard**: http://localhost:3000
- **API Docs**: http://localhost:3001/docs

## 📖 Usage

### Connect Your AI Tool

Configure your AI coding tool to use Bawwab:

```
Endpoint: http://localhost:3001/v1
API Key: [your-admin-api-key]
Model: kr/claude-sonnet-4
```

### Supported Models

| Model | Provider | Context | Features |
|-------|----------|---------|----------|
| Claude Sonnet 4 | Anthropic | 200K | Vision, Tools, Thinking |
| GPT-4o | OpenAI | 128K | Vision, Tools |
| DeepSeek Chat | DeepSeek | 64K | Thinking, Tools |
| Gemini 2.5 Pro | Google | 1M | Vision, Tools, TTS |
| GLM 4.5 | Zhipu | 128K | Vision, Thinking |

## 🛠️ Tech Stack

- **API Gateway**: Fastify, TypeScript, Zod
- **Dashboard**: React, Vite, Tailwind CSS, Recharts
- **Cache**: Redis (with in-memory fallback)
- **Auth**: JWT, Rate Limiting

## 📄 License

MIT License — see [LICENSE](LICENSE)

## 🤝 Contributing

Contributions welcome! Please read our [Contributing Guide](CONTRIBUTING.md).

---

Built with 💚 by the Bawwab team. Inspired by the open-source community.
