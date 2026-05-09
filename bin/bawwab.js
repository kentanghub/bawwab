#!/usr/bin/env node

import { spawn } from 'child_process';
import { createServer, request as httpRequest } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const PORT = process.env.PORT || '20128';
const API_PORT = process.env.API_PORT || '3001';

console.log(`
╔═══════════════════════════════════════════════╗
║                                               ║
║   🚪 Bawwab — Intelligent AI Gateway          ║
║                                               ║
╚═══════════════════════════════════════════════╝
`);

async function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);
  if (major < 18) {
    console.error('❌ Node.js 18+ required. Current:', version);
    process.exit(1);
  }
}

async function checkApiBuilt() {
  const apiDist = join(rootDir, 'api', 'dist', 'index.js');
  const dashboardDist = join(rootDir, 'dashboard', 'dist', 'index.html');
  
  if (!existsSync(apiDist) || !existsSync(dashboardDist)) {
    console.log('📦 Building Bawwab for first run...\n');
    
    const build = spawn('npm', ['run', 'build'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true
    });
    
    await new Promise((resolve, reject) => {
      build.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Build failed with code ${code}`));
      });
    });
  }
}

async function startApi() {
  console.log('🚀 Starting API Gateway...');
  
  const api = spawn('node', [join(rootDir, 'api', 'dist', 'index.js')], {
    env: { ...process.env, PORT: API_PORT },
    stdio: 'pipe'
  });
  
  api.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.log(`[API] ${line}`);
  });
  
  api.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line) console.error(`[API] ${line}`);
  });
  
  api.on('close', (code) => {
    console.log(`API exited with code ${code}`);
    process.exit(code || 0);
  });
  
  // Wait for API to be ready
  await new Promise((resolve) => setTimeout(resolve, 3000));
  
  return api;
}

async function startDashboard() {
  console.log('🎨 Starting Dashboard...');
  
  const handler = (req, res) => {
    // API proxy - includes /api/, /v1/, /ws/, /docs
    if (req.url.startsWith('/api/') || req.url.startsWith('/v1/') || req.url.startsWith('/ws/') || req.url.startsWith('/docs')) {
      proxyRequest(req, res);
      return;
    }
    
    // Static files
    let filePath = join(rootDir, 'dashboard', 'dist', req.url === '/' ? 'index.html' : req.url);
    
    if (!existsSync(filePath)) {
      filePath = join(rootDir, 'dashboard', 'dist', 'index.html');
    }
    
    try {
      const content = readFileSync(filePath);
      const ext = filePath.split('.').pop();
      const mimeTypes = {
        'html': 'text/html',
        'js': 'application/javascript',
        'css': 'text/css',
        'json': 'application/json',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'svg': 'image/svg+xml'
      };
      
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  };
  
  const server = createServer(handler);

  // WebSocket upgrade proxy
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/ws/')) {
      const options = {
        hostname: 'localhost',
        port: API_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${API_PORT}` }
      };
      
      const proxy = httpRequest(options);
      proxy.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
          Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
          '\r\n\r\n');
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
      });
      
      proxy.on('error', (err) => {
        console.error('[Proxy] WS upgrade error:', err.message);
        socket.destroy();
      });
      
      proxy.end();
    } else {
      socket.destroy();
    }
  });
  
  server.listen(PORT, () => {
    console.log(`\n✅ Bawwab is running!`);
    console.log(`\n   🌐 Dashboard:    http://localhost:${PORT}`);
    console.log(`   🔌 API:          http://localhost:${PORT}/v1`);
    console.log(`   📖 API Docs:     http://localhost:${PORT}/docs`);
    console.log(`\n   📝 Config file:  ~/.bawwab/config.json`);
    console.log(`\n   Press Ctrl+C to stop\n`);
  });
  
  return server;
}

function proxyRequest(req, res) {
  const options = {
    hostname: 'localhost',
    port: API_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${API_PORT}` }
  };
  
  const proxy = httpRequest(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  
  proxy.on('error', (err) => {
    console.error('[Proxy] Error:', err.message);
    res.writeHead(502);
    res.end('API unavailable');
  });
  
  req.pipe(proxy);
}

async function main() {
  await checkNodeVersion();
  await checkApiBuilt();
  await startApi();
  await startDashboard();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
