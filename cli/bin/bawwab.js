#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliRoot = resolve(__dirname, '..');
const apiRoot = resolve(cliRoot, '..', 'api');
const dashboardRoot = resolve(cliRoot, '..', 'dashboard');

// Load package.json
const pkg = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf-8'));

// Parse args
const args = process.argv.slice(2);
let command = 'start';
let port = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[++i], 10);
  } else if (!args[i].startsWith('-')) {
    command = args[i];
  }
}

// Load .env from api directory
function loadEnv() {
  const envPath = resolve(apiRoot, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

function showBanner() {
  console.log(`
 ██▄ ██▀ ▄▀▄ █▀▄ ▄▀▀ █▀▄ █ █
 █▄█ █▄▄ █▀█ █▄▀ ▀▄▄ █▀▄ ▀▄▀
 v${pkg.version} — Unified AI Gateway
`);
}

function getPort() {
  return port || parseInt(process.env.PORT || '3000', 10);
}

function checkPort(portNum) {
  return new Promise((resolvePromise) => {
    const req = http.get(`http://127.0.0.1:${portNum}/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolvePromise({ up: true, status: res.statusCode }));
    });
    req.on('error', () => resolvePromise({ up: false }));
    req.setTimeout(2000, () => { req.destroy(); resolvePromise({ up: false }); });
  });
}

async function cmdStart() {
  loadEnv();

  if (port) {
    process.env.PORT = String(port);
  }

  showBanner();
  const p = getPort();
  console.log(`Starting Bawwab API server...`);
  console.log(`API root: ${apiRoot}`);

  const entrypoint = resolve(apiRoot, 'dist', 'index.js');
  if (!existsSync(entrypoint)) {
    console.error(`\nError: API entrypoint not found at ${entrypoint}`);
    console.error('Run "npm run build" in the api/ directory first.');
    process.exit(1);
  }

  const child = spawn('node', [entrypoint], {
    cwd: apiRoot,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Wait a moment, then show URLs
  setTimeout(() => {
    console.log(`\n▸ API:       http://localhost:${p}`);
    console.log(`▸ Dashboard: http://localhost:${p} (or check dashboard config)`);
    console.log(`▸ Health:    http://localhost:${p}/health`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  }, 1500);

  const shutdown = () => {
    console.log('\nShutting down...');
    child.kill('SIGTERM');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function cmdStatus() {
  const p = getPort();
  const result = await checkPort(p);
  if (result.up) {
    console.log(`✅ Bawwab API is running on port ${p} (HTTP ${result.status})`);
  } else {
    console.log(`❌ No Bawwab API detected on port ${p}`);
    process.exit(1);
  }
}

function cmdVersion() {
  console.log(`bawwab v${pkg.version}`);
}

switch (command) {
  case 'start':
    cmdStart();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'version':
    cmdVersion();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: bawwab [start|status|version] [--port <number>]');
    process.exit(1);
}
