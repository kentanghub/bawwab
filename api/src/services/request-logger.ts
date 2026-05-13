/**
 * Request Logger — JSONL file-based logging with in-memory ring buffer.
 *
 * Logs each request to ~/.bawwab/logs/requests-YYYY-MM-DD.log (JSONL).
 * Keeps last 100 requests in memory for dashboard.
 * Rotates logs older than 30 days.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const LOGS_DIR = path.join(os.homedir(), '.bawwab', 'logs');
const RING_BUFFER_SIZE = 100;
const RETENTION_DAYS = 30;

// Ensure logs directory exists
fs.mkdirSync(LOGS_DIR, { recursive: true });

export interface LogEntry {
  timestamp: string;
  provider: string;
  model: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost: number;
  latency_ms: number;
  connection_id?: string;
  virtual_key_id?: string;
  endpoint?: string;
  meta?: Record<string, any>;
}

interface LogStats {
  totalLogged: number;
  todayCount: number;
  bufferSize: number;
  oldestInBuffer: string | null;
  newestInBuffer: string | null;
  logFiles: string[];
}

// ─── Ring buffer ─────────────────────────────────────────────────────────
const recentBuffer: LogEntry[] = [];
let totalLogged = 0;

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function logFilePath(dateStr?: string): string {
  return path.join(LOGS_DIR, `requests-${dateStr || todayDateStr()}.log`);
}

function appendToFile(entry: LogEntry): void {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logFilePath(), line, 'utf-8');
  } catch {
    // silently ignore write failures
  }
}

function rotateOldLogs(): void {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(LOGS_DIR);
    for (const file of files) {
      if (!file.startsWith('requests-') || !file.endsWith('.log')) continue;
      // Extract date: requests-YYYY-MM-DD.log → YYYY-MM-DD
      const dateStr = file.slice(9, 19);
      const fileDate = new Date(dateStr + 'T00:00:00Z');
      if (fileDate.getTime() < cutoff) {
        try {
          fs.unlinkSync(path.join(LOGS_DIR, file));
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

// Run rotation on module load and every hour
rotateOldLogs();
setInterval(rotateOldLogs, 60 * 60 * 1000).unref();

// ─── Export singleton ────────────────────────────────────────────────────

export const requestLogger = {
  /**
   * Log a request to file and ring buffer.
   */
  logRequest(data: Partial<LogEntry> & { provider: string; model: string }): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      provider: data.provider,
      model: data.model,
      status: data.status || 'ok',
      input_tokens: data.input_tokens || 0,
      output_tokens: data.output_tokens || 0,
      cached_tokens: data.cached_tokens || 0,
      reasoning_tokens: data.reasoning_tokens || 0,
      cost: data.cost || 0,
      latency_ms: data.latency_ms || 0,
      connection_id: data.connection_id,
      virtual_key_id: data.virtual_key_id,
      endpoint: data.endpoint,
      meta: data.meta,
    };

    // Append to file
    appendToFile(entry);

    // Ring buffer
    recentBuffer.push(entry);
    if (recentBuffer.length > RING_BUFFER_SIZE) {
      recentBuffer.shift();
    }

    totalLogged++;
  },

  /**
   * Get recent log entries from the ring buffer.
   */
  getRecentLogs(count: number = RING_BUFFER_SIZE): LogEntry[] {
    const n = Math.min(count, recentBuffer.length);
    return recentBuffer.slice(-n);
  },

  /**
   * Get logging statistics.
   */
  getLogStats(): LogStats {
    let logFiles: string[] = [];
    try {
      logFiles = fs.readdirSync(LOGS_DIR)
        .filter(f => f.startsWith('requests-') && f.endsWith('.log'))
        .sort();
    } catch { /* ignore */ }

    // Count today's lines
    let todayCount = 0;
    try {
      const content = fs.readFileSync(logFilePath(), 'utf-8');
      todayCount = content.split('\n').filter(l => l.trim()).length;
    } catch { /* file may not exist yet */ }

    return {
      totalLogged,
      todayCount,
      bufferSize: recentBuffer.length,
      oldestInBuffer: recentBuffer.length > 0 ? recentBuffer[0].timestamp : null,
      newestInBuffer: recentBuffer.length > 0 ? recentBuffer[recentBuffer.length - 1].timestamp : null,
      logFiles,
    };
  },
};
