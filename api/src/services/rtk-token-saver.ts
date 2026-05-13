/**
 * RTK Token Saver Service
 *
 * Auto-compresses tool_result content in LLM request messages to save 20-40% tokens.
 * Ported from 9Router's RTK implementation (open-sse/rtk/).
 *
 * Detects 5 message shapes (OpenAI tool string, OpenAI tool array,
 * Claude tool_result string, Claude tool_result array, function_call_output).
 * Never compresses error messages. Only compresses text >= 500 bytes.
 * Auto-detects content type and applies the best filter.
 * Never returns empty content, never grows the input.
 */

import { logger } from './logger.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const RAW_CAP = 10 * 1024 * 1024;           // 10 MiB
const MIN_COMPRESS_SIZE = 500;               // bytes; skip tiny blobs
const DETECT_WINDOW = 1024;                  // autodetect peeks first N chars
const GIT_DIFF_HUNK_MAX_LINES = 100;         // per-hunk line cap
const DEDUP_LINE_MAX = 2000;                 // dedupLog truncation cap
const GREP_PER_FILE_MAX = 10;                // match cap per file
const FIND_PER_DIR_MAX = 10;                 // files per directory cap
const FIND_TOTAL_DIR_MAX = 20;               // directories max
const TREE_MAX_LINES = 200;                  // tree output cap
const SMART_TRUNCATE_HEAD = 120;             // lines kept from top
const SMART_TRUNCATE_TAIL = 60;              // lines kept from bottom
const SMART_TRUNCATE_MIN_LINES = 250;        // only kick in above this
const READ_NUMBERED_MIN_HIT_RATIO = 0.7;
const LS_EXT_SUMMARY_TOP = 5;

const LS_NOISE_DIRS = [
  'node_modules', '.git', 'target', '__pycache__',
  '.next', 'dist', 'build', '.venv', 'venv',
  '.cache', '.idea', '.vscode', '.DS_Store',
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RtkStats {
  originalBytes: number;
  compressedBytes: number;
  savedBytes: number;
  savedPercent: number;
  filterUsed: string;
  compressedCount: number;
}

interface InternalStats {
  bytesBefore: number;
  bytesAfter: number;
  hits: Array<{ shape: string; filter: string; saved: number }>;
}

type FilterFn = ((text: string) => string) & { filterName?: string };

// ─── Filters ─────────────────────────────────────────────────────────────────

const gitDiff: FilterFn = function gitDiff(input: string): string {
  const result: string[] = [];
  let currentFile = '';
  let added = 0;
  let removed = 0;
  let inHunk = false;
  let hunkShown = 0;
  let hunkSkipped = 0;
  let wasTruncated = false;
  const maxLines = 500;
  const maxHunkLines = GIT_DIFF_HUNK_MAX_LINES;

  const lines = input.split('\n');

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (hunkSkipped > 0) {
        result.push(`  ... (${hunkSkipped} lines truncated)`);
        wasTruncated = true;
        hunkSkipped = 0;
      }
      if (currentFile && (added > 0 || removed > 0)) {
        result.push(`  +${added} -${removed}`);
      }
      const parts = line.split(' b/');
      currentFile = parts.length > 1 ? parts.slice(1).join(' b/') : 'unknown';
      result.push(`\n${currentFile}`);
      added = 0;
      removed = 0;
      inHunk = false;
      hunkShown = 0;
    } else if (line.startsWith('@@')) {
      if (hunkSkipped > 0) {
        result.push(`  ... (${hunkSkipped} lines truncated)`);
        wasTruncated = true;
        hunkSkipped = 0;
      }
      inHunk = true;
      hunkShown = 0;
      result.push(`  ${line}`);
    } else if (inHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        added += 1;
        if (hunkShown < maxHunkLines) {
          result.push(`  ${line}`);
          hunkShown += 1;
        } else {
          hunkSkipped += 1;
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removed += 1;
        if (hunkShown < maxHunkLines) {
          result.push(`  ${line}`);
          hunkShown += 1;
        } else {
          hunkSkipped += 1;
        }
      } else if (hunkShown < maxHunkLines && !line.startsWith('\\')) {
        if (hunkShown > 0) {
          result.push(`  ${line}`);
          hunkShown += 1;
        }
      }
    }

    if (result.length >= maxLines) {
      result.push('\n... (more changes truncated)');
      wasTruncated = true;
      break;
    }
  }

  if (hunkSkipped > 0) {
    result.push(`  ... (${hunkSkipped} lines truncated)`);
    wasTruncated = true;
  }

  if (currentFile && (added > 0 || removed > 0)) {
    result.push(`  +${added} -${removed}`);
  }

  if (wasTruncated) {
    result.push('[full diff: rtk git diff --no-compact]');
  }

  return result.join('\n');
};
gitDiff.filterName = 'git-diff';

const grep: FilterFn = function grep(input: string): string {
  const byFile = new Map<string, Array<[string, string]>>();
  let total = 0;

  for (const line of input.split('\n')) {
    const first = line.indexOf(':');
    if (first === -1) continue;
    const second = line.indexOf(':', first + 1);
    if (second === -1) continue;
    const file = line.slice(0, first);
    const lineNumStr = line.slice(first + 1, second);
    const content = line.slice(second + 1);
    if (!/^\d+$/.test(lineNumStr)) continue;
    total++;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push([lineNumStr, content]);
  }

  if (total === 0) return input;

  const files = Array.from(byFile.keys()).sort();
  let out = `${total} matches in ${files.length}F:\n\n`;

  for (const file of files) {
    const matches = byFile.get(file)!;
    out += `[file] ${file} (${matches.length}):\n`;
    const show = matches.slice(0, GREP_PER_FILE_MAX);
    for (const [lineNum, content] of show) {
      out += `  ${lineNum.padStart(4)}: ${content.trim()}\n`;
    }
    if (matches.length > GREP_PER_FILE_MAX) {
      out += `  +${matches.length - GREP_PER_FILE_MAX}\n`;
    }
    out += '\n';
  }

  return out;
};
grep.filterName = 'grep';

const find: FilterFn = function find(input: string): string {
  const lines = input.split('\n').filter(l => l.trim());
  if (lines.length === 0) return input;

  const byDir = new Map<string, string[]>();

  for (const path of lines) {
    const lastSlash = path.lastIndexOf('/');
    let dir: string;
    let basename: string;
    if (lastSlash === -1) {
      dir = '.';
      basename = path;
    } else {
      dir = path.slice(0, lastSlash) || '/';
      basename = path.slice(lastSlash + 1);
    }
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(basename);
  }

  const dirs = Array.from(byDir.keys()).sort();
  let out = `${lines.length} files in ${dirs.length} dirs:\n\n`;

  const showDirs = dirs.slice(0, FIND_TOTAL_DIR_MAX);
  for (const dir of showDirs) {
    const files = byDir.get(dir)!;
    out += `${dir}/ (${files.length}):\n`;
    const showFiles = files.slice(0, FIND_PER_DIR_MAX);
    for (const f of showFiles) out += `  ${f}\n`;
    if (files.length > FIND_PER_DIR_MAX) {
      out += `  +${files.length - FIND_PER_DIR_MAX}\n`;
    }
    out += '\n';
  }
  if (dirs.length > FIND_TOTAL_DIR_MAX) {
    out += `+${dirs.length - FIND_TOTAL_DIR_MAX} more dirs\n`;
  }

  return out;
};
find.filterName = 'find';

const ls: FilterFn = function ls(input: string): string {
  const LS_DATE_RE = /\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4}|\d{2}:\d{2})\s+/;

  function humanSize(bytes: number): string {
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${bytes}B`;
  }

  function parseLsLine(line: string): { fileType: string; size: number; name: string } | null {
    const m = LS_DATE_RE.exec(line);
    if (!m) return null;
    const name = line.slice(m.index + m[0].length);
    const beforeDate = line.slice(0, m.index);
    const beforeParts = beforeDate.split(/\s+/).filter(Boolean);
    if (beforeParts.length < 4) return null;

    const perms = beforeParts[0];
    const fileType = perms.charAt(0);

    let size = 0;
    for (let i = beforeParts.length - 1; i >= 0; i--) {
      const n = Number(beforeParts[i]);
      if (Number.isInteger(n) && String(n) === beforeParts[i]) { size = n; break; }
    }
    return { fileType, size, name };
  }

  const dirs: string[] = [];
  const files: Array<[string, string]> = [];
  const byExt = new Map<string, number>();

  for (const line of input.split('\n')) {
    if (line.startsWith('total ') || line.length === 0) continue;
    const parsed = parseLsLine(line);
    if (!parsed) continue;
    if (parsed.name === '.' || parsed.name === '..') continue;
    if (LS_NOISE_DIRS.includes(parsed.name)) continue;

    if (parsed.fileType === 'd') {
      dirs.push(parsed.name);
    } else if (parsed.fileType === '-' || parsed.fileType === 'l') {
      const dot = parsed.name.lastIndexOf('.');
      const ext = dot > 0 ? parsed.name.slice(dot) : 'no ext';
      byExt.set(ext, (byExt.get(ext) || 0) + 1);
      files.push([parsed.name, humanSize(parsed.size)]);
    }
  }

  if (dirs.length === 0 && files.length === 0) return input;

  let out = '';
  for (const d of dirs) out += `${d}/\n`;
  for (const [name, size] of files) out += `${name}  ${size}\n`;

  let summary = `\nSummary: ${files.length} files, ${dirs.length} dirs`;
  if (byExt.size > 0) {
    const ext = Array.from(byExt.entries()).sort((a, b) => b[1] - a[1]);
    const parts = ext.slice(0, LS_EXT_SUMMARY_TOP).map(([e, c]) => `${c} ${e}`);
    summary += ` (${parts.join(', ')}`;
    if (ext.length > LS_EXT_SUMMARY_TOP) {
      summary += `, +${ext.length - LS_EXT_SUMMARY_TOP} more`;
    }
    summary += ')';
  }

  return out + summary;
};
ls.filterName = 'ls';

const tree: FilterFn = function tree(input: string): string {
  const lines = input.split('\n');
  if (lines.length === 0) return input;

  const filtered: string[] = [];
  for (const line of lines) {
    if (line.includes('director') && line.includes('file')) continue;
    if (line.trim() === '' && filtered.length === 0) continue;
    filtered.push(line);
  }

  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === '') {
    filtered.pop();
  }

  if (filtered.length > TREE_MAX_LINES) {
    const cut = filtered.length - TREE_MAX_LINES;
    return filtered.slice(0, TREE_MAX_LINES).join('\n') + `\n... +${cut} more lines`;
  }

  return filtered.join('\n');
};
tree.filterName = 'tree';

const smartTruncate: FilterFn = function smartTruncate(input: string): string {
  const lines = input.split('\n');
  if (lines.length < SMART_TRUNCATE_MIN_LINES) return input;

  const head = lines.slice(0, SMART_TRUNCATE_HEAD);
  const tail = lines.slice(lines.length - SMART_TRUNCATE_TAIL);
  const cut = lines.length - head.length - tail.length;
  return [...head, `... +${cut} lines truncated`, ...tail].join('\n');
};
smartTruncate.filterName = 'smart-truncate';

const dedupLog: FilterFn = function dedupLog(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  let prev: string | null = null;
  let runCount = 0;
  let blankStreak = 0;

  const flushRun = () => {
    if (prev !== null && runCount > 1) {
      out.push(`  ... (${runCount - 1} duplicate lines)`);
    }
  };

  for (const line of lines) {
    if (line.trim() === '') {
      if (blankStreak < 1) out.push(line);
      blankStreak += 1;
      flushRun();
      prev = null;
      runCount = 0;
      continue;
    }
    blankStreak = 0;
    if (line === prev) {
      runCount += 1;
      continue;
    }
    flushRun();
    out.push(line);
    prev = line;
    runCount = 1;
    if (out.length >= DEDUP_LINE_MAX) {
      out.push(`... (truncated at ${DEDUP_LINE_MAX} lines)`);
      return out.join('\n');
    }
  }
  flushRun();
  return out.join('\n');
};
dedupLog.filterName = 'dedup-log';

const readNumbered: FilterFn = function readNumbered(input: string): string {
  const lines = input.split('\n');
  if (lines.length < SMART_TRUNCATE_MIN_LINES) return input;

  const head = lines.slice(0, SMART_TRUNCATE_HEAD);
  const tail = lines.slice(lines.length - SMART_TRUNCATE_TAIL);
  const cut = lines.length - head.length - tail.length;

  return [
    ...head,
    `... +${cut} lines truncated (file continues)`,
    ...tail,
  ].join('\n');
};
readNumbered.filterName = 'read-numbered';

// ─── Autodetect ──────────────────────────────────────────────────────────────

const RE_GIT_DIFF = /^diff --git /m;
const RE_GIT_DIFF_HUNK = /^@@ /m;
const RE_TREE_GLYPH = /[├└]──|│  /;
const RE_LS_ROW = /^[-dlbcps][rwx-]{9}/m;
const RE_LS_TOTAL = /^total \d+$/m;
const READ_NUMBERED_LINE_RE = /^\s*\d+\|/;

function isGrepLine(line: string): boolean {
  const first = line.indexOf(':');
  if (first === -1) return false;
  const second = line.indexOf(':', first + 1);
  if (second === -1) return false;
  const lineno = line.slice(first + 1, second);
  return /^\d+$/.test(lineno);
}

function isPathLike(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.includes(':')) return false;
  return t.startsWith('.') || t.startsWith('/') || t.includes('/');
}

function isLineNumbered(lines: string[]): boolean {
  let hits = 0;
  let nonEmpty = 0;
  const sample = lines.slice(0, 100);
  for (const l of sample) {
    if (l.length === 0) continue;
    nonEmpty++;
    if (READ_NUMBERED_LINE_RE.test(l)) hits++;
  }
  if (nonEmpty < 5) return false;
  return hits / nonEmpty >= READ_NUMBERED_MIN_HIT_RATIO;
}

function countMatches(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return (text.match(g) || []).length;
}

function autoDetectFilter(text: string): FilterFn | null {
  const head = text.length > DETECT_WINDOW ? text.slice(0, DETECT_WINDOW) : text;

  if (RE_GIT_DIFF.test(head) || RE_GIT_DIFF_HUNK.test(head)) return gitDiff;

  const lines = head.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);

  // Grep: first 5 non-empty lines, ANY matches "file:number:content"
  const first5 = nonEmpty.slice(0, 5);
  if (first5.some(isGrepLine)) return grep;

  // Find: ALL non-empty lines path-like (no ':'), >=3 lines
  if (nonEmpty.length >= 3 && nonEmpty.every(isPathLike)) return find;

  // Tree: contains box-drawing glyphs typical of `tree` command
  if (RE_TREE_GLYPH.test(head)) return tree;

  // ls -la: has "total N" header or >=3 rows starting with perms string
  if (RE_LS_TOTAL.test(head) || countMatches(head, RE_LS_ROW) >= 3) return ls;

  // Line-numbered file dump ("  N|content")
  if (lines.length >= SMART_TRUNCATE_MIN_LINES && isLineNumbered(lines)) {
    return readNumbered;
  }

  // Fallback: dedupLog for generic multi-line noise with duplicates
  if (nonEmpty.length >= 5) return dedupLog;

  // Last resort: big blob with no structure — smart truncate
  if (text.split('\n').length >= SMART_TRUNCATE_MIN_LINES) return smartTruncate;

  return null;
}

// ─── Safe Apply ──────────────────────────────────────────────────────────────

function safeApply(fn: FilterFn, text: string): string {
  if (typeof fn !== 'function') return text;
  try {
    const out = fn(text);
    if (typeof out !== 'string') return text;
    return out;
  } catch (err: any) {
    const name = fn.filterName || fn.name || 'anonymous';
    logger.warn({ filter: name, error: err?.message || err }, '[RTK] Filter panicked, passing through raw output');
    return text;
  }
}

// ─── Core Compression ────────────────────────────────────────────────────────

function compressText(text: string, stats: InternalStats, shape: string): string {
  const bytesIn = text.length;
  stats.bytesBefore += bytesIn;

  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const fn = autoDetectFilter(text);
  if (!fn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  const out = safeApply(fn, text);

  // Safety: never return empty, never grow the input
  if (!out || out.length === 0 || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn;
    return text;
  }

  stats.bytesAfter += out.length;
  stats.hits.push({ shape, filter: fn.filterName || fn.name, saved: bytesIn - out.length });
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Global RTK enabled state */
let rtkEnabled = true;

/** Aggregate stats from the last call */
let lastStats: RtkStats = {
  originalBytes: 0,
  compressedBytes: 0,
  savedBytes: 0,
  savedPercent: 0,
  filterUsed: 'none',
  compressedCount: 0,
};

/** Cumulative lifetime stats */
let lifetimeStats = {
  totalOriginalBytes: 0,
  totalCompressedBytes: 0,
  totalRequests: 0,
  totalCompressed: 0,
};

/**
 * Compress tool_result content in message arrays.
 * Detects 5 message shapes:
 *  - OpenAI tool string: { role: "tool", content: "string" }
 *  - OpenAI tool array:  { role: "tool", content: [{ type: "text", text }] }
 *  - Claude tool_result string: { type: "tool_result", content: "string" }
 *  - Claude tool_result array:  { type: "tool_result", content: [{ type: "text", text }] }
 *  - function_call_output: { type: "function_call_output", output: "string" | [...] }
 *
 * Never compresses when is_error === true. Only compresses text >= 500 bytes.
 */
export function compressMessages(messages: any[], enabled?: boolean): { messages: any[]; stats: RtkStats } {
  const useEnabled = enabled !== undefined ? enabled : rtkEnabled;

  if (!useEnabled || !Array.isArray(messages)) {
    return { messages, stats: { originalBytes: 0, compressedBytes: 0, savedBytes: 0, savedPercent: 0, filterUsed: 'none', compressedCount: 0 } };
  }

  const internalStats: InternalStats = { bytesBefore: 0, bytesAfter: 0, hits: [] };

  try {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;

      // Shape 5: OpenAI Responses — { type: "function_call_output", output: string | [...] }
      if (msg.type === 'function_call_output') {
        if (typeof msg.output === 'string') {
          msg.output = compressText(msg.output, internalStats, 'openai-responses-string');
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k];
            if (part && part.type === 'input_text' && typeof part.text === 'string') {
              part.text = compressText(part.text, internalStats, 'openai-responses-array');
            }
          }
        }
        continue;
      }

      // Shape 1: OpenAI tool message — { role: "tool", content: "string" }
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        msg.content = compressText(msg.content, internalStats, 'openai-tool');
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // Shape 1b: OpenAI tool message — { role: "tool", content: [{ type: "text", text }] }
      if (msg.role === 'tool') {
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k];
          if (part && part.type === 'text' && typeof part.text === 'string') {
            part.text = compressText(part.text, internalStats, 'openai-tool-array');
          }
        }
        continue;
      }

      // Shape 2/3: blocks array with tool_result entries
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j];
        if (!block || block.type !== 'tool_result') continue;
        if (block.is_error === true) continue; // preserve error traces

        if (typeof block.content === 'string') {
          // Shape 2: claude string form
          block.content = compressText(block.content, internalStats, 'claude-string');
        } else if (Array.isArray(block.content)) {
          // Shape 3: claude array form — compress each text part
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k];
            if (part && part.type === 'text' && typeof part.text === 'string') {
              part.text = compressText(part.text, internalStats, 'claude-array');
            }
          }
        }
      }
    }
  } catch (err: any) {
    logger.warn({ error: err?.message || err }, '[RTK] compressMessages error');
    return { messages, stats: { originalBytes: 0, compressedBytes: 0, savedBytes: 0, savedPercent: 0, filterUsed: 'error', compressedCount: 0 } };
  }

  const savedBytes = internalStats.bytesBefore - internalStats.bytesAfter;
  const savedPercent = internalStats.bytesBefore > 0
    ? Math.round((savedBytes / internalStats.bytesBefore) * 10000) / 100
    : 0;
  const filters = Array.from(new Set(internalStats.hits.map(h => h.filter))).join(', ') || 'none';

  const stats: RtkStats = {
    originalBytes: internalStats.bytesBefore,
    compressedBytes: internalStats.bytesAfter,
    savedBytes,
    savedPercent,
    filterUsed: filters,
    compressedCount: internalStats.hits.length,
  };

  lastStats = stats;

  // Update lifetime stats
  lifetimeStats.totalOriginalBytes += internalStats.bytesBefore;
  lifetimeStats.totalCompressedBytes += internalStats.bytesAfter;
  lifetimeStats.totalRequests++;
  lifetimeStats.totalCompressed += internalStats.hits.length;

  if (internalStats.hits.length > 0) {
    logger.info({
      savedBytes,
      savedPercent,
      filters,
      compressedCount: internalStats.hits.length,
    }, '[RTK] Compression applied');
  }

  return { messages, stats };
}

/** Test compression on a single text string */
export function testCompression(text: string): {
  original: string;
  compressed: string;
  filter: string;
  originalBytes: number;
  compressedBytes: number;
  savedBytes: number;
  savedPercent: number;
} {
  if (!text || text.length < MIN_COMPRESS_SIZE) {
    return {
      original: text,
      compressed: text,
      filter: 'none (too small)',
      originalBytes: text?.length || 0,
      compressedBytes: text?.length || 0,
      savedBytes: 0,
      savedPercent: 0,
    };
  }

  const fn = autoDetectFilter(text);
  if (!fn) {
    return {
      original: text,
      compressed: text,
      filter: 'none (no match)',
      originalBytes: text.length,
      compressedBytes: text.length,
      savedBytes: 0,
      savedPercent: 0,
    };
  }

  const out = safeApply(fn, text);
  const filterName = fn.filterName || fn.name || 'unknown';

  if (!out || out.length === 0 || out.length >= text.length) {
    return {
      original: text,
      compressed: text,
      filter: `${filterName} (no savings)`,
      originalBytes: text.length,
      compressedBytes: text.length,
      savedBytes: 0,
      savedPercent: 0,
    };
  }

  const savedBytes = text.length - out.length;
  return {
    original: text.slice(0, 500) + (text.length > 500 ? '...' : ''),
    compressed: out.slice(0, 500) + (out.length > 500 ? '...' : ''),
    filter: filterName,
    originalBytes: text.length,
    compressedBytes: out.length,
    savedBytes,
    savedPercent: Math.round((savedBytes / text.length) * 10000) / 100,
  };
}

/** Enable or disable RTK compression globally */
export function setRtkEnabled(enabled: boolean): void {
  rtkEnabled = enabled;
  logger.info({ enabled }, '[RTK] Toggled');
}

/** Check if RTK is enabled */
export function isRtkEnabled(): boolean {
  return rtkEnabled;
}

/** Get the last compression stats */
export function getRtkStats(): RtkStats {
  return { ...lastStats };
}

/** Get lifetime stats */
export function getRtkLifetimeStats(): {
  enabled: boolean;
  totalRequests: number;
  totalCompressed: number;
  totalOriginalBytes: number;
  totalCompressedBytes: number;
  totalSavedBytes: number;
  totalSavedPercent: number;
} {
  const totalSavedBytes = lifetimeStats.totalOriginalBytes - lifetimeStats.totalCompressedBytes;
  return {
    enabled: rtkEnabled,
    totalRequests: lifetimeStats.totalRequests,
    totalCompressed: lifetimeStats.totalCompressed,
    totalOriginalBytes: lifetimeStats.totalOriginalBytes,
    totalCompressedBytes: lifetimeStats.totalCompressedBytes,
    totalSavedBytes,
    totalSavedPercent: lifetimeStats.totalOriginalBytes > 0
      ? Math.round((totalSavedBytes / lifetimeStats.totalOriginalBytes) * 10000) / 100
      : 0,
  };
}
