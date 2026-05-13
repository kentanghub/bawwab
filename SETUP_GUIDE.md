# Bawwab Setup Guide — Install di PC (Step by Step)

## 📋 Prerequisites

Sebelum mulai, pastikan PC kamu sudah install:

- **Node.js** v18+ (rekomendasi v20 LTS)
- **npm** v9+ (biasanya bundled dengan Node.js)
- **Git**

### Cek versi
```bash
node --version    # Harus v18+
npm --version     # Harus v9+
git --version     # Harus ada
```

Kalau belum install, download di:
- Node.js: https://nodejs.org (download LTS)
- Git: https://git-scm.com/downloads

---

## 🚀 Step 1: Clone Repository

```bash
# Buka terminal (Command Prompt / PowerShell / Terminal)

# Pilih folder tempat mau install, contoh:
cd Documents

# Clone repo bawwab
git clone https://github.com/kentanghub/bawwab.git

# Masuk ke folder project
cd bawwab
```

---

## 📦 Step 2: Install Dependencies

```bash
# Install root dependencies
npm install

# Install API dependencies
cd api
npm install

# Install Dashboard dependencies
cd ../dashboard
npm install
```

---

## ⚙️ Step 3: Konfigurasi Environment

```bash
# Kembali ke folder api
cd ../api

# Copy file environment template
cp .env.example .env
```

### Edit file `.env` dengan text editor (VS Code, Notepad, dll):

```env
PORT=3000
ADMIN_API_KEY=bawwab-admin-key-2024-secure-random-string
JWT_SECRET=bawwab-jwt-secret-minimal-32-characters-long
LOG_LEVEL=info

# Provider API Keys (isi yang kamu punya)
OPENAI_API_KEY=sk-your-openai-key
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
GEMINI_API_KEY=AI-your-gemini-key
GROQ_API_KEY=gsk-your-groq-key
DEEPSEEK_API_KEY=sk-your-deepseek-key

# Optional: Redis (kalau punya)
# REDIS_URL=redis://localhost:6379
```

> 💡 **Tips:** Untuk development lokal, cukup isi `ADMIN_API_KEY` dan `JWT_SECRET`. Provider keys bisa diisi nanti.

---

## 🔨 Step 4: Build Project

```bash
# Pastikan masih di folder api/
npm run build
```

Kalau sukses, akan muncul folder `api/dist/` berisi file JavaScript hasil compile.

---

## ▶️ Step 5: Jalankan Server

### Opsi A: Jalankan Manual (Development)
```bash
# Di folder api/
npm start

# Akan muncul:
# 🚀 Bawwab API running on http://0.0.0.0:3000
```

Buka browser ke: **http://localhost:3000**

### Opsi B: Jalankan dengan Auto-Restart (Development)
```bash
# Install nodemon secara global (sekali saja)
npm install -g nodemon

# Jalankan dengan nodemon
nodemon dist/index.js
```

### Opsi C: Jalankan sebagai Service (Production)

#### Windows (dengan pm2):
```bash
# Install pm2
npm install -g pm2

# Jalankan
pm2 start dist/index.js --name bawwab-api

# Auto-start saat boot
pm2 startup
pm2 save
```

#### Linux/Mac (dengan systemd):
```bash
# Copy service file
sudo cp pfft-miner.service /etc/systemd/system/bawwab.service

# Edit service file sesuai path
sudo nano /etc/systemd/system/bawwab.service

# Enable & start
sudo systemctl daemon-reload
sudo systemctl enable --now bawwab

# Cek status
sudo systemctl status bawwab
```

---

## 🧪 Step 6: Verifikasi

```bash
# Cek health endpoint
curl http://localhost:3000/health

# Response:
# {"status":"healthy","version":"0.1.0",...}

# Cek list providers
curl http://localhost:3000/v1/providers

# Cek OAuth providers (termasuk kiro cookie)
curl http://localhost:3000/v1/oauth/providers
```

Buka dashboard di browser: **http://localhost:3000**

---

## 🍪 Step 7: Setup Kiro Cookie Auth (Optional)

### 7a. Extract Cookies dari Browser

1. Login ke https://kiro.dev di browser (Chrome/Firefox)
2. Buka DevTools (F12 atau Ctrl+Shift+I)
3. Tab **Application** (Chrome) atau **Storage** (Firefox)
4. Sidebar kiri → **Cookies** → `https://kiro.dev`
5. Copy semua cookie yang namanya diawali `aor_`

### 7b. Submit ke Bawwab

**Cara 1: Via Script**
```bash
# Copy file script dari project
# Buka terminal baru, jangan tutup server yang running

# Paste cookies ke terminal
python3 scripts/submit-kiro-cookies.py
```

**Cara 2: Via curl**
```bash
curl -X POST http://localhost:3000/v1/oauth/kiro/cookie-entry \
  -H "Content-Type: application/json" \
  -d '{
    "cookies": "aor_session=xxx; aor_token=yyy",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  }'
```

### 7c. Cek Status
```bash
curl http://localhost:3000/v1/oauth/providers

# Kiro harus muncul: type=cookie, connected=true
```

---

## 💬 Step 8: Test Chat

```bash
# Chat ke kiro via bawwab
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-api-key>" \
  -d '{
    "model": "kr/claude-sonnet-4.5",
    "messages": [{"role": "user", "content": "Hello from Bawwab!"}]
  }'
```

---

## 🔄 Step 9: Update (kalau ada versi baru)

```bash
cd bawwab
git pull origin main

# Re-install dependencies
npm install
cd api && npm install
cd ../dashboard && npm install

# Re-build
cd ../api
npm run build

# Restart server
npm start
```

---

## 🛠️ Troubleshooting

### Error: "Cannot find module"
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Error: "Port 3000 already in use"
```bash
# Ganti port di .env
PORT=3001

# Atau kill process yang pakai port 3000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac:
lsof -ti:3000 | xargs kill -9
```

### Error: "tsc command not found"
```bash
# Install TypeScript secara global
npm install -g typescript

# Atau pakai npx
npx tsc
```

### Dashboard tidak muncul
```bash
# Build dashboard dulu
cd dashboard
npm run build

# Balik ke api
cd ../api
npm start
```

---

## 📁 Struktur Folder

```
bawwab/
├── api/                    # Backend API (Fastify + TypeScript)
│   ├── src/
│   │   ├── index.ts        # Entry point
│   │   ├── routes/         # API routes
│   │   │   ├── chat.ts     # Chat completion
│   │   │   ├── oauth.ts    # OAuth & cookie auth
│   │   │   └── ...
│   │   ├── services/       # Business logic
│   │   │   ├── oauth-manager.ts  # Cookie store
│   │   │   ├── intelligent-router.ts
│   │   │   └── ...
│   │   └── plugins/        # Provider configs
│   │       └── manager.ts  # Kiro config
│   ├── dist/               # Hasil build (JS)
│   ├── .env                # Environment variables
│   └── package.json
├── dashboard/              # Frontend (React)
│   ├── src/
│   ├── dist/               # Hasil build
│   └── package.json
├── scripts/                # Helper scripts
│   ├── extract-kiro-cookies.js
│   └── submit-kiro-cookies.py
└── README.md
```

---

## 🌐 Akses dari LAN/Internet

Kalau mau akses Bawwab dari device lain di network:

```bash
# Cek IP lokal kamu
# Windows:
ipconfig

# Linux/Mac:
ifconfig

# Akses dari device lain:
# http://<IP-KAMU>:3000
# Contoh: http://192.168.1.100:3000
```

---

## ✅ Checklist Setup

- [ ] Node.js v18+ terinstall
- [ ] Git terinstall
- [ ] Repo di-clone
- [ ] Dependencies di-install
- [ ] File `.env` dibuat & dikonfigurasi
- [ ] Build sukses (`npm run build`)
- [ ] Server running (`npm start`)
- [ ] Health check sukses
- [ ] Dashboard bisa dibuka di browser
- [ ] Kiro cookies tersubmit (optional)
- [ ] Chat test sukses (optional)

Selamat! 🎉 Bawwab sudah siap dipakai.
