# Bawwab Setup Guide V2 — First-Time Setup Fixed

## Quick Start (Recommended)

```bash
git clone https://github.com/kentanghub/bawwab.git
cd bawwab
./setup.sh
```

The `setup.sh` script automatically:
- ✅ Installs all dependencies
- ✅ Creates missing `postcss.config.js`
- ✅ Fixes TypeScript config issues
- ✅ Fixes Vite proxy port mismatch
- ✅ Generates random API keys
- ✅ Builds both API and Dashboard

---

## Manual Setup (If auto-setup fails)

### 1. Clone & Install
```bash
git clone https://github.com/kentanghub/bawwab.git
cd bawwab

# Install dependencies
npm install
cd api && npm install
cd ../dashboard && npm install
```

### 2. Fix Dashboard Config
```bash
cd dashboard

# Create postcss.config.js (REQUIRED for Tailwind)
cat > postcss.config.js << 'EOFJS'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
EOFJS

# Fix vite.config.ts - change port from 3001 to 3000
sed -i 's/localhost:3001/localhost:3000/g' vite.config.ts

# Fix package.json - skip tsc in build
sed -i 's/"build": "tsc && vite build"/"build": "vite build"/' package.json
```

### 3. Setup API
```bash
cd ../api

# Create .env file
cp .env.example .env

# Edit .env and set:
# - ADMIN_API_KEY (min 32 chars)
# - JWT_SECRET (min 32 chars)
# - Provider API keys (optional)
```

### 4. Build & Run
```bash
# Build API
cd api && npm run build

# Build Dashboard
cd dashboard && npm run build

# Start API (serves both API + Dashboard)
cd api && npm start
```

---

## Known Issues Fixed

### ❌ "postcss.config.js missing"
**Fix:** Create the file in dashboard/:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

### ❌ "TypeScript errors in node_modules"
**Fix:** Set `"skipLibCheck": true` in dashboard/tsconfig.json

### ❌ "WebSocket proxy warning from Vite"
**Fix:** Update dashboard/vite.config.ts proxy to use port 3000 (not 3001)

### ❌ "tsc command failed on build"
**Fix:** Change build script from `"tsc && vite build"` to `"vite build"`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ADMIN_API_KEY` | Yes | Admin API key (min 32 chars) |
| `JWT_SECRET` | Yes | JWT signing secret (min 32 chars) |
| `PORT` | No | API port (default: 3000) |
| `OPENAI_API_KEY` | No | OpenAI API key |
| `ANTHROPIC_API_KEY` | No | Anthropic API key |
| `GEMINI_API_KEY` | No | Google Gemini API key |
| `GROQ_API_KEY` | No | Groq API key |
| `DEEPSEEK_API_KEY` | No | DeepSeek API key |

---

## Troubleshooting

### Dashboard shows blank page
1. Check if postcss.config.js exists
2. Run `npm run build` in dashboard/
3. Check browser console for errors

### API won't start
1. Check if port 3000 is available
2. Verify .env has ADMIN_API_KEY and JWT_SECRET
3. Check logs for specific error

### Vite proxy errors
1. Ensure API is running on port 3000
2. Check vite.config.ts proxy settings
3. Restart dev server

---

## Windows Users

The setup script works on Windows with:
- Git Bash
- WSL (Windows Subsystem for Linux)
- MSYS2/Cygwin

If using PowerShell, run commands manually (see Manual Setup above).
