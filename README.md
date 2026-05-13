<div align="center">

# 🚪 Bawwab

**Unified AI Gateway — 45+ LLM providers dalam satu OpenAI-compatible API**

Intelligent routing • Smart fallback • RTK Token Saver • Multi-account • Persistent storage

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-green.svg)](https://nodejs.org)

</div>

---

## ✨ Fitur

- **45+ AI Providers** — OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, Together, Fireworks, Cohere, Perplexity, NVIDIA, xAI, Kimi, Qwen, Ollama, Azure, Cloudflare, dan 20+ lagi
- **OpenAI-Compatible API** — Drop-in replacement, cukup ganti `baseURL` dan `apiKey`
- **RTK Token Saver** — Auto-compress `tool_result` content, hemat 20-40% token
- **Intelligent Routing** — Pilih provider terbaik berdasarkan latency, cost, dan availability
- **Smart Fallback** — 3-tier fallback chain: Premium → Balanced → Free/cheap
- **Multi-Account Round-Robin** — Rotate antar banyak account per provider
- **Circuit Breaker** — CLOSED / OPEN / HALF_OPEN state per provider
- **Persistent Storage** — SQLite WAL mode, data survive restart
- **Virtual API Keys** — Multi-tenant key dengan per-key quota dan rate limit
- **Model Alias System** — Shorthand seperti `kr/claude-sonnet-4.5`
- **Pricing Tracking** — Hitung cost per request otomatis untuk 50+ model
- **Auto Token Refresh** — OAuth token auto-refresh sebelum expired
- **Semantic Cache** — Cache response berdasarkan similarity
- **Content Safety** — PII redaction, prompt injection detection
- **A/B Testing** — Split traffic antar model dan track win rate
- **Webhook Events** — Fire event ke URL external (HMAC-SHA256 signed)
- **Request Logging** — JSONL daily log files dengan 30-day rotation
- **Cloud Sync** — Export/import state untuk multi-device
- **Real-time Dashboard** — Monitoring quota, circuit breaker, cache, webhooks
- **Dashboard Auth** — Password protection via `DASHBOARD_PASSWORD` env var
- **Unit Tests** — 63 tests covering routing, fallback, RTK, rate limiter, aliases
- **Docker** — Multi-stage Dockerfile + docker-compose
- **CI/CD** — GitHub Actions: lint → build → test → Docker
- **Sentry Integration** — Error tracking via `SENTRY_DSN` env var
- **Rate Limiter Persistence** — SQLite-backed, survives restart
- **CLI Tool** — `npm install -g bawwab` → `bawwab start`

---

## 🚀 Quick Start

### 1. Install via CLI (Recommended)

```bash
git clone https://github.com/kentanghub/bawwab.git
cd bawwab/api && npm install && npm run build
cd ../cli && npm install && npm link
```

Sekarang bisa jalankan dari mana saja:

```bash
bawwab start
```

### 2. Manual Install

```bash
git clone https://github.com/kentanghub/bawwab.git
cd bawwab

# Install dependencies
npm install
cd api && npm install && npm run build
cd ../dashboard && npm install

# Copy dan edit environment
cp api/.env.example api/.env
# Edit api/.env — isi minimal 1 provider API key

# Jalankan API
cd api && npm start
```

API akan jalan di `http://localhost:3000`

### 3. Docker (Production)

```bash
git clone https://github.com/kentanghub/bawwab.git
cd bawwab

# Edit .env file
cp api/.env.example api/.env
# Edit api/.env — isi minimal JWT_SECRET dan ADMIN_API_KEY

# Build dan jalankan
docker compose up -d

# Cek status
curl http://localhost:3001/health
```

### 4. Jalankan Dashboard

```bash
cd dashboard
npm run dev      # development (port 5173)
npm run build    # production build
```

---

## ⚙️ Konfigurasi

### Environment Variables (`api/.env`)

```env
# Server
PORT=3000
NODE_ENV=production

# Security (WAJIB di production)
ADMIN_API_KEY=your-random-admin-key-min-32-chars
JWT_SECRET=your-jwt-secret-min-32-chars

# Logging
LOG_LEVEL=info

# Sentry Error Tracking (opsional)
SENTRY_DSN=https://xxx@sentry.io/xxx

# Dashboard Password Protection (opsional)
DASHBOARD_PASSWORD=your-secure-password

# Provider API Keys (isi minimal 1)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AI...
GROQ_API_KEY=gsk_...
DEEPSEEK_API_KEY=sk-...
MISTRAL_API_KEY=...
TOGETHER_API_KEY=...
FIREWORKS_API_KEY=...
COHERE_API_KEY=...
PERPLEXITY_API_KEY=...
NVIDIA_API_KEY=...
XAI_API_KEY=xai-...
KIMI_API_KEY=...
QWEN_API_KEY=...
MINIMAX_API_KEY=...
SILICONFLOW_API_KEY=...
CEREBRAS_API_KEY=...
NEBIUS_API_KEY=...
CHUTES_API_KEY=...
HYPERBOLIC_API_KEY=...

# Optional
REDIS_URL=redis://localhost:6379
CORS_ORIGIN=https://yourdomain.com
```

---

## 📡 API Endpoints

### Chat (OpenAI-Compatible)

```
POST /v1/chat/completions     — Chat completion (streaming & non-streaming)
POST /v1/batch/chat           — Batch multiple chat requests
GET  /v1/models               — List available models
```

### Management (butuh `x-api-key: ADMIN_API_KEY`)

```
GET  /v1/providers            — List semua provider
GET  /v1/oauth/providers      — List OAuth providers
GET  /v1/combos               — List provider combos
GET  /v1/quota                — Quota usage
GET  /v1/virtual-keys         — List virtual API keys
POST /v1/virtual-keys         — Create new virtual key
GET  /v1/circuit-breaker      — Circuit breaker status
GET  /v1/semantic-cache       — Semantic cache stats
GET  /v1/webhooks             — List webhook subscriptions
POST /v1/webhooks             — Subscribe webhook
GET  /v1/benchmarks           — Model performance rankings
POST /v1/safety/scan          — Content safety scan
```

### RTK Token Saver

```
GET  /v1/rtk/stats            — RTK compression stats
POST /v1/rtk/toggle           — Enable/disable RTK
POST /v1/rtk/test             — Test compression on sample text
```

### A/B Testing

```
GET  /v1/ab-tests             — List tests
POST /v1/ab-tests             — Create test
GET  /v1/ab-tests/:id/stats   — Get stats with winner
DELETE /v1/ab-tests/:id       — Delete test
```

### Model Aliases

```
GET  /v1/aliases              — List aliases
POST /v1/aliases              — Set alias (alias → target)
DELETE /v1/aliases/:alias     — Remove alias
POST /v1/aliases/resolve      — Resolve model string
```

### Pricing

```
GET  /v1/pricing              — List all pricing
POST /v1/pricing              — Override pricing for a model
POST /v1/pricing/calculate    — Calculate cost for given usage
```

### Cloud Sync

```
GET  /v1/sync/status          — Sync status & table counts
POST /v1/sync/export          — Export full state (JSON)
POST /v1/sync/import          — Import state from JSON
```

---

## 🔑 OAuth Providers

| Provider | Flow | Cara Connect |
|----------|------|-------------|
| Claude | Device Code | `POST /v1/oauth/claude/initiate` → polling |
| Gemini | Device Code | `POST /v1/oauth/gemini/initiate` → polling |
| GitHub | Device Code | `POST /v1/oauth/github/initiate` → polling |
| Codex | Device Code | `POST /v1/oauth/codex/initiate` → polling |
| Copilot | Device Code | `POST /v1/oauth/copilot/initiate` → polling |
| Qwen | Device Code | `POST /v1/oauth/qwen/initiate` → polling |
| Cursor | Token-only | `POST /v1/oauth/cursor/token-entry` |
| Cline | Token-only | `POST /v1/oauth/cline/token-entry` |
| Kiro | Token-only | `POST /v1/oauth/kiro/token-entry` |
| Antigravity | Token-only | `POST /v1/oauth/antigravity/token-entry` |

---

## 🏗️ Arsitektur

```
┌─────────────┐      ┌─────────────┐      ┌─────────────────────┐
│   Client    │─────▶│  Bawwab API  │─────▶│ Intelligent Router  │
│ (OpenAI SDK)│      │  (Fastify)  │      │  (Latency/Cost/Up)  │
└─────────────┘      └──────┬──────┘      └─────────────────────┘
                            │
               ┌────────────┼────────────┐
               ▼            ▼            ▼
         ┌────────┐   ┌─────────┐   ┌────────┐
         │OpenAI  │   │Anthropic│   │Gemini  │
         │Groq    │   │DeepSeek │   │Mistral │
         │...45+  │   │...      │   │...     │
         └────────┘   └─────────┘   └────────┘
```

### Services

| Service | Deskripsi |
|---------|-----------|
| `database.ts` | SQLite persistent storage (WAL mode) |
| `intelligent-router.ts` | Multi-factor scoring: health, latency, cost, capabilities |
| `smart-fallback.ts` | 3-tier fallback chain |
| `rtk-token-saver.ts` | Auto-compress tool_result (8 filters) |
| `multi-account.ts` | Round-robin + fill-first account rotation |
| `circuit-breaker.ts` | CLOSED → OPEN → HALF_OPEN per provider |
| `semantic-cache.ts` | Similarity-based caching |
| `virtual-keys.ts` | Multi-tenant API keys with quotas |
| `oauth-manager.ts` | OAuth device code flow + auto token refresh |
| `model-aliases.ts` | 90+ provider prefix aliases |
| `pricing-tracker.ts` | 50+ models with per-token cost calculation |
| `request-logger.ts` | JSONL daily logs, 30-day rotation |
| `webhooks.ts` | HMAC-SHA256 signed event delivery |
| `ab-testing.ts` | Model comparison with win rate tracking |
| `cloud-sync.ts` | Export/import state for multi-device |
| `content-safety.ts` | PII redaction, injection detection |
| `batch-processor.ts` | Parallel batch execution |
| `format-translator.ts` | OpenAI ↔ Claude ↔ Gemini format conversion |

---

## 🛡️ Security

- **Constant-time admin key comparison** — `crypto.timingSafeEqual()`
- **SHA-256 hashed API keys** — Keys stored as hashes, never plaintext
- **SSRF protection** — Webhook URLs validated against internal/private networks
- **Parameterized SQL** — All queries use `?` placeholders, no string interpolation
- **Content safety** — PII redaction, prompt injection detection, toxic filtering
- **Rate limiting** — Global (100/min) + per-key configurable limits
- **CORS** — Configurable origin, disabled by default in production
- **Request body limit** — 10MB max
- **Input validation** — Zod schemas for chat requests

---

## 📦 Data Storage

Data disimpan di `~/.bawwab/`:

```
~/.bawwab/
├── db/
│   └── data.sqlite          # SQLite database (WAL mode)
└── logs/
    └── requests-YYYY-MM-MM.log  # JSONL daily logs (30-day rotation)
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `settings` | App settings |
| `api_keys` | Main API keys |
| `virtual_keys` | Virtual API keys with quotas |
| `provider_connections` | Multi-account provider connections |
| `oauth_tokens` | OAuth tokens (persistent) |
| `cookie_credentials` | Cookie-based auth |
| `model_aliases` | User-defined model aliases |
| `combos` | Provider combo definitions |
| `pricing_overrides` | Custom pricing per model |
| `webhooks` | Webhook subscriptions |
| `ab_tests` | A/B test configurations |
| `ab_test_results` | A/B test results |
| `usage_history` | Per-request usage log |
| `usage_daily` | Daily aggregated stats |
| `circuit_breaker_state` | Circuit breaker per provider |
| `provider_health` | Provider health tracking |
| `request_details` | Full request observability |
| `cloud_sync` | Cloud sync state |

---

## 🧪 Contoh Penggunaan

### Chat Completion

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $YOUR_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Dengan Model Alias

```bash
# kr/claude-sonnet-4.5 → Kiro provider, Claude Sonnet 4.5 model
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $YOUR_API_KEY" \
  -d '{
    "model": "kr/claude-sonnet-4.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Dengan Combo (Fallback Chain)

```bash
# premium-coding combo → tries Claude Opus, falls back to GPT-4o, then DeepSeek
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $YOUR_API_KEY" \
  -d '{
    "model": "combo/premium-coding",
    "messages": [{"role": "user", "content": "Write a Python function"}]
  }'
```

### Create Virtual Key

```bash
curl -X POST http://localhost:3000/v1/virtual-keys \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ADMIN_API_KEY" \
  -d '{
    "name": "my-app",
    "rateLimitRpm": 60,
    "quotaDailyRequests": 1000
  }'
```

### Subscribe Webhook

```bash
curl -X POST http://localhost:3000/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ADMIN_API_KEY" \
  -d '{
    "url": "https://your-app.com/webhook",
    "events": ["request.completed", "provider.down"]
  }'
```

---

## 🔧 CLI Commands

```bash
bawwab                  # Start server (default)
bawwab start            # Start server
bawwab start --port 8080  # Start on custom port
bawwab status           # Check if server is running
bawwab version          # Show version
```

---

## 🧑‍💻 Development

```bash
# Build API
cd api && npm run build

# Dev mode (hot reload)
cd api && npm run dev

# Build Dashboard
cd dashboard && npm run build

# Link CLI globally
cd cli && npm link
```

---

## 🧪 Testing

```bash
cd api
npm test        # Run 63 unit tests
npm run build   # Build TypeScript
```

Tests cover:
- RTK Token Saver (compression filters, autodetect)
- Intelligent Router (direct match, alias, combo, scoring)
- Smart Fallback (tier classification, health filtering)
- Rate Limiter (sliding window, quota, persistence)
- Model Aliases (prefix parsing, name inference, DB aliases)

## 📄 License

MIT
