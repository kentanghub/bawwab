# Bawwab

Unified AI Gateway — kumpulkan semua LLM provider dalam satu API endpoint yang kompatibel OpenAI. Dengan intelligent routing, smart fallback, quota tracking, circuit breaker, semantic cache, virtual API keys, dan banyak fitur advanced lainnya.

## Fitur

- **45+ AI Providers** — OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, Together, Fireworks, Cohere, Perplexity, NVIDIA, xAI, Kimi, Qwen, Ollama, Azure, Cloudflare, dan 20+ lagi
- **OpenAI-Compatible API** — Drop-in replacement, cukup ganti `baseURL` dan `apiKey`
- **Intelligent Routing** — Otomatis pilih provider terbaik berdasarkan latency, cost, dan availability
- **Smart Fallback** — Kalau provider A down, otomatis pindah ke provider B tanpa retry manual
- **Circuit Breaker** — CLOSED / OPEN / HALF_OPEN state untuk setiap provider
- **Semantic Cache** — Cache response berdasarkan similarity, bukan exact match
- **Virtual API Keys** — Multi-tenant key dengan per-key quota dan rate limit
- **Content Safety** — PII redaction, prompt injection detection, toxic filtering
- **Request Deduplication** — Concurrent identical request hanya forward 1x
- **A/B Testing** — Split traffic antar model dan track win rate
- **Webhook Events** — Fire event ke URL external (request.completed, provider.down, dll)
- **Batch Processing** — Kirim multiple chat completion sekaligus
- **Edge Caching** — Redis-backed TTL cache
- **Model Benchmarking** — Auto-rank model by latency, cost, throughput, error rate
- **OAuth Providers** — Claude, Gemini, GitHub, Codex, Copilot, Qwen (device code flow)
- **Custom Provider Combos** — Definisikan chain provider sesuai kebutuhan
- **Real-time Dashboard** — Monitoring quota, circuit breaker, cache, webhooks

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/kentanghub/bawwab.git
cd bawwab
npm install          # install root deps
cd api && npm install
cd ../dashboard && npm install
```

### 2. Konfigurasi Environment

Buat file `api/.env`:

```env
PORT=3000
ADMIN_API_KEY=your-random-admin-key-min-32-chars
JWT_SECRET=your-jwt-secret-min-32-chars
LOG_LEVEL=info

# Provider API Keys (isi minimal 1)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AI...
GROQ_API_KEY=gsk_...
DEEPSEEK_API_KEY=sk-...
# ... dan seterusnya (lihat daftar provider di bawah)

# Optional: Redis
# REDIS_URL=redis://localhost:6379
```

### 3. Jalankan API

```bash
cd api
npm run build
npm start
```

API akan jalan di `http://localhost:3000`

### 4. Jalankan Dashboard (Dev)

```bash
cd dashboard
npm run dev
```

Dashboard akan jalan di `http://localhost:5173`

### 5. Coba Chat

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## API Endpoints

### Chat (OpenAI-Compatible)

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/v1/chat/completions` | Chat completion (streaming & non-streaming) |
| POST | `/v1/batch/chat` | Batch multiple chat requests |

### Management (butuh `x-api-key: ADMIN_API_KEY`)

| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/v1/providers` | List semua provider |
| GET | `/v1/oauth/providers` | List OAuth providers |
| GET | `/v1/combos` | List provider combos |
| GET | `/v1/quota` | Quota usage |
| GET | `/v1/virtual-keys` | List virtual API keys |
| POST | `/v1/virtual-keys` | Create new virtual key |
| GET | `/v1/circuit-breaker` | Circuit breaker status |
| GET | `/v1/semantic-cache` | Semantic cache stats |
| GET | `/v1/webhooks` | List webhook subscriptions |
| POST | `/v1/webhooks` | Subscribe webhook |
| GET | `/v1/benchmarks` | Model performance rankings |
| POST | `/v1/safety/scan` | Content safety scan |

---

## Daftar Provider

### LLM
OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, Together, Fireworks, Cohere, Perplexity, NVIDIA, xAI, Kimi, Qwen, AliCode, Volcengine, BytePlus, KiloCode, NanoBanana, CommandCode, Azure, Cloudflare, GitLab Duo, CodeBuddy, Xiaomi MiMo, Ollama, Vertex AI, Vertex Partner, Cerebras, Nebius, Chutes, Hyperbolic, MiniMax, SiliconFlow, GLM

### Embedding
OpenAI, Gemini, Jina

### Image
Pollinations, DALL-E 3 (via OpenAI)

### Audio
Deepgram, AssemblyAI, Gemini TTS/STT, OpenAI Whisper/TTS

### Search
Tavily, Perplexity

### Web
Jina (web fetch)

---

## OAuth Providers

| Provider | Flow | Cara Connect |
|----------|------|-------------|
| Claude | Device Code | POST `/v1/oauth/claude/initiate` → polling |
| Gemini | Device Code | POST `/v1/oauth/gemini/initiate` → polling |
| GitHub | Device Code | POST `/v1/oauth/github/initiate` → polling |
| Codex | Device Code | POST `/v1/oauth/codex/initiate` → polling |
| Copilot | Device Code | POST `/v1/oauth/copilot/initiate` → polling |
| Qwen | Device Code | POST `/v1/oauth/qwen/initiate` → polling |
| Cursor | Token-only | POST `/v1/oauth/cursor/token-entry` |
| Cline | Token-only | POST `/v1/oauth/cline/token-entry` |
| Kiro | Token-only | POST `/v1/oauth/kiro/token-entry` |
| Antigravity | Token-only | POST `/v1/oauth/antigravity/token-entry` |

---

## Arsitektur

```
┌─────────────┐      ┌─────────────┐      ┌─────────────────────┐
│   Client    │────▶│  Bawwab API  │────▶│ Intelligent Router  │
│ (OpenAI SDK)│      │  (Fastify)  │      │  (Latency/Cost/Up)  │
└─────────────┘      └──────┬──────┘      └─────────────────────┘
                            │
               ┌────────────┼────────────┐
               ▼            ▼            ▼
         ┌────────┐   ┌─────────┐   ┌────────┐
         │OpenAI  │   │Anthropic│   │Gemini  │
         │Groq    │   │DeepSeek │   │Mistral │
         │...     │   │...      │   │...     │
         └────────┘   └─────────┘   └────────┘
```

### Services
- `intelligent-router.ts` — Pilih provider terbaik
- `smart-fallback.ts` — Fallback chain jika provider fail
- `circuit-breaker.ts` — State machine per provider
- `semantic-cache.ts` — Similarity-based caching
- `quota-tracker.ts` — Per-provider usage tracking
- `virtual-keys.ts` — Multi-tenant API keys
- `content-safety.ts` — PII & injection detection
- `request-deduplicator.ts` — Concurrent dedup
- `model-benchmark.ts` — Auto-ranking
- `batch-processor.ts` — Parallel batch execution

---

## Development

```bash
# Build API
cd api && npm run build

# Build Dashboard
cd dashboard && npm run build

# Run tests
cd api && npm test
```

---

## License

MIT
