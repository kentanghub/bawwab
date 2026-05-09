/**
 * Tool Output Compressor
 * Detects and compresses tool outputs (git diff, grep, ls, tree, etc.)
 * before sending to LLM. Saves 20-40% input tokens per request.
 *
 * Inspired by RTK (github.com/rtk-ai/rtk) and 9Router.
 * Safe by design: if compression fails or increases size, returns original.
 */

import { logger } from './logger.js';

export interface CompressionResult {
  original: string;
  compressed: string;
  savings: number; // percentage
  filter: string;
  applied: boolean;
}

export class ToolCompressor {
  private enabled = true;

  enable() { this.enabled = true; }
  disable() { this.enabled = false; }
  isEnabled() { return this.enabled; }

  /**
   * Auto-detect tool output type and apply best filter
   */
  compress(text: string): CompressionResult {
    if (!this.enabled || !text || text.length < 200) {
      return { original: text, compressed: text, savings: 0, filter: 'none', applied: false };
    }

    try {
      // Peek first 1KB to detect type
      const preview = text.slice(0, 1024);
      const filter = this.detectFilter(preview);

      if (!filter) {
        return { original: text, compressed: text, savings: 0, filter: 'none', applied: false };
      }

      const compressed = this.applyFilter(filter, text);

      // Safety: if compressed is larger or empty, return original
      if (!compressed || compressed.length >= text.length) {
        return { original: text, compressed: text, savings: 0, filter: filter + '-skipped', applied: false };
      }

      const savings = Math.round(((text.length - compressed.length) / text.length) * 100);

      logger.debug({ filter, savings, originalLen: text.length, compressedLen: compressed.length }, '[ToolCompressor] Applied');

      return { original: text, compressed, savings, filter, applied: true };
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : 'Unknown' }, '[ToolCompressor] Error, returning original');
      return { original: text, compressed: text, savings: 0, filter: 'error', applied: false };
    }
  }

  /**
   * Detect tool type from content preview
   */
  private detectFilter(preview: string): string | null {
    const patterns: [RegExp, string][] = [
      // Git diff
      [/^(diff --git|index [a-f0-9]+\.\.\.|@@ -\d+,\d+ \+\d+,\d+ @@)/m, 'git-diff'],
      // Git status
      [/^(\?\? |M\s+|A\s+|D\s+|R\s+|C\s+|[\s\w]+\s+.*)/m, 'git-status'],
      // Grep output
      [/[^:]+:\d+:[^\n]+/m, 'grep'],
      // Find output (list of paths)
      [/^([\/.~]?[\w\-/]+\/)+[\w\-.]+$/m, 'find'],
      // ls output
      [/^[\-dlrwxsSt]+\s+\d+\s+\w+\s+\w+\s+\d+/m, 'ls'],
      // Tree output
      [/^[│├└─\s]*[\w\-.]+\/?$/m, 'tree'],
      // Error log (repeated patterns)
      [/ERROR|FATAL|WARN|Exception|Stack trace/i, 'dedup-log'],
      // JSON array/object large
      [/^\s*\{[\s\S]*\}\s*$/m, 'smart-truncate'],
      // Numbered list / search results
      [/^\d+[:\.)\s]+/m, 'search-list'],
    ];

    for (const [regex, filter] of patterns) {
      if (regex.test(preview)) return filter;
    }

    // Default: if text is very long with repetitive structure
    if (preview.length > 500 && this.hasRepetitiveStructure(preview)) {
      return 'smart-truncate';
    }

    return null;
  }

  /**
   * Apply compression filter
   */
  private applyFilter(filter: string, text: string): string {
    switch (filter) {
      case 'git-diff':
        return this.compressGitDiff(text);
      case 'git-status':
        return this.compressGitStatus(text);
      case 'grep':
        return this.compressGrep(text);
      case 'find':
        return this.compressFind(text);
      case 'ls':
        return this.compressLs(text);
      case 'tree':
        return this.compressTree(text);
      case 'dedup-log':
        return this.compressDedupLog(text);
      case 'smart-truncate':
        return this.smartTruncate(text);
      case 'search-list':
        return this.compressSearchList(text);
      default:
        return text;
    }
  }

  /**
   * Compress git diff output
   * Removes context lines, keeps only changed lines + small context
   */
  private compressGitDiff(diff: string): string {
    const lines = diff.split('\n');
    const result: string[] = [];
    let inHunk = false;
    let contextBuffer: string[] = [];
    let removedCount = 0;
    let addedCount = 0;

    for (const line of lines) {
      // File header
      if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        result.push(line);
        continue;
      }

      // Hunk header
      if (line.startsWith('@@')) {
        if (contextBuffer.length > 0) {
          result.push(`... (${contextBuffer.length} context lines) ...`);
          contextBuffer = [];
        }
        result.push(line);
        inHunk = true;
        removedCount = 0;
        addedCount = 0;
        continue;
      }

      if (!inHunk) {
        result.push(line);
        continue;
      }

      // Changed lines
      if (line.startsWith('+') || line.startsWith('-')) {
        if (contextBuffer.length > 2) {
          result.push(`... (${contextBuffer.length - 2} context) ...`);
          contextBuffer = contextBuffer.slice(-2);
        }
        result.push(...contextBuffer);
        contextBuffer = [];
        result.push(line);
        if (line.startsWith('-')) removedCount++;
        if (line.startsWith('+')) addedCount++;
        continue;
      }

      // Context line
      contextBuffer.push(line);
    }

    // Summary
    if (removedCount > 0 || addedCount > 0) {
      result.push(`\n[Diff Summary: ${removedCount} removed, ${addedCount} added]`);
    }

    return result.join('\n');
  }

  /**
   * Compress git status
   * Collapse similar entries
   */
  private compressGitStatus(status: string): string {
    const lines = status.split('\n').filter(Boolean);
    const byType: Record<string, string[]> = {};

    for (const line of lines) {
      const match = line.match(/^(\?\?|M|A|D|R|C)\s+(.+)$/);
      if (match) {
        const type = match[1];
        const file = match[2];
        if (!byType[type]) byType[type] = [];
        byType[type].push(file);
      } else {
        // Untracked or other
        if (!byType['untracked']) byType['untracked'] = [];
        byType['untracked'].push(line.trim());
      }
    }

    const result: string[] = [];
    for (const [type, files] of Object.entries(byType)) {
      if (files.length > 5) {
        result.push(`${type}: ${files.slice(0, 3).join(', ')}, ... (${files.length - 3} more)`);
      } else {
        result.push(`${type}: ${files.join(', ')}`);
      }
    }

    return result.join('\n');
  }

  /**
   * Compress grep output
   * Group by file, collapse multiple matches
   */
  private compressGrep(grep: string): string {
    const lines = grep.split('\n').filter(Boolean);
    const byFile: Record<string, string[]> = {};

    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.+)$/);
      if (match) {
        const file = match[1];
        const content = match[3].trim();
        if (!byFile[file]) byFile[file] = [];
        byFile[file].push(content);
      }
    }

    const result: string[] = [];
    for (const [file, matches] of Object.entries(byFile)) {
      if (matches.length > 5) {
        result.push(`${file}: "${matches[0]}", "${matches[1]}", ... (${matches.length - 2} more matches)`);
      } else {
        result.push(`${file}: ${matches.map(m => `"${m}"`).join(', ')}`);
      }
    }

    return result.join('\n');
  }

  /**
   * Compress find output (list of paths)
   * Group by directory, collapse deep trees
   */
  private compressFind(find: string): string {
    const paths = find.split('\n').filter(Boolean);
    const byDir: Record<string, string[]> = {};

    for (const path of paths) {
      const dir = path.substring(0, path.lastIndexOf('/') + 1) || '.';
      const file = path.substring(path.lastIndexOf('/') + 1);
      if (!byDir[dir]) byDir[dir] = [];
      byDir[dir].push(file);
    }

    const result: string[] = [];
    for (const [dir, files] of Object.entries(byDir)) {
      if (files.length > 8) {
        result.push(`${dir}: ${files.slice(0, 5).join(', ')}, ... (${files.length - 5} more)`);
      } else {
        result.push(`${dir}: ${files.join(', ')}`);
      }
    }

    return result.join('\n');
  }

  /**
   * Compress ls output
   * Keep summary stats, truncate file list
   */
  private compressLs(ls: string): string {
    const lines = ls.split('\n').filter(Boolean);
    const total = lines.find(l => l.startsWith('total'));
    const files = lines.filter(l => !l.startsWith('total') && !l.startsWith('d') && !l.startsWith('l'));
    const dirs = lines.filter(l => l.startsWith('d'));
    const symlinks = lines.filter(l => l.startsWith('l'));

    const result: string[] = [];
    if (total) result.push(total);
    result.push(`[${dirs.length} dirs, ${files.length} files, ${symlinks.length} symlinks]`);

    if (files.length > 10) {
      result.push(files.slice(0, 8).join('\n'));
      result.push(`... (${files.length - 8} more files) ...`);
    } else {
      result.push(...files);
    }

    return result.join('\n');
  }

  /**
   * Compress tree output
   * Collapse deep branches
   */
  private compressTree(tree: string): string {
    const lines = tree.split('\n').filter(Boolean);
    const result: string[] = [];
    let depthCount = 0;
    let lastDepth = 0;

    for (const line of lines) {
      const depth = (line.match(/[│├└]/g) || []).length;

      if (depth > lastDepth + 1 && depth > 3) {
        depthCount++;
        if (depthCount === 1) {
          result.push('  ... (deep branches collapsed) ...');
        }
        continue;
      }

      depthCount = 0;
      result.push(line);
      lastDepth = depth;
    }

    return result.join('\n');
  }

  /**
   * Deduplicate log output
   * Collapse repeated error patterns
   */
  private compressDedupLog(log: string): string {
    const lines = log.split('\n');
    const result: string[] = [];
    let lastPattern = '';
    let dupCount = 0;

    for (const line of lines) {
      // Extract error pattern (remove timestamps, line numbers)
      const pattern = line.replace(/\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[\.,]?\d*/g, '')
        .replace(/:\d+\)?$/g, '')
        .replace(/0x[a-f0-9]+/gi, '0x...')
        .trim();

      if (pattern === lastPattern && pattern.length > 10) {
        dupCount++;
        continue;
      }

      if (dupCount > 0) {
        result.push(`[${dupCount} duplicate lines suppressed]`);
        dupCount = 0;
      }

      result.push(line);
      lastPattern = pattern;
    }

    if (dupCount > 0) {
      result.push(`[${dupCount} duplicate lines suppressed]`);
    }

    return result.join('\n');
  }

  /**
   * Smart truncate large structured text
   * Keeps beginning and end, truncates middle
   */
  private smartTruncate(text: string): string {
    const maxLen = 8000;
    if (text.length <= maxLen) return text;

    const head = text.slice(0, 3000);
    const tail = text.slice(-3000);
    const removed = text.length - head.length - tail.length;

    return `${head}\n\n... [${removed} chars truncated, ${Math.round(removed / text.length * 100)}% of content] ...\n\n${tail}`;
  }

  /**
   * Compress search/list output
   * Collapse numbered lists
   */
  private compressSearchList(list: string): string {
    const lines = list.split('\n').filter(Boolean);
    if (lines.length <= 15) return list;

    const result = lines.slice(0, 12);
    result.push(`... (${lines.length - 12} more items) ...`);
    return result.join('\n');
  }

  /**
   * Check if text has repetitive structure
   */
  private hasRepetitiveStructure(text: string): boolean {
    const lines = text.split('\n').slice(0, 50);
    if (lines.length < 10) return false;

    // Check for repeated prefixes
    const prefixes = new Set(lines.map(l => l.trim().slice(0, 10)));
    return prefixes.size / lines.length < 0.3; // < 30% unique prefixes = repetitive
  }

  /**
   * Compress all tool_results in messages
   * Returns new messages array with compressed content
   */
  compressMessages(messages: any[]): any[] {
    return messages.map(msg => {
      if (typeof msg.content === 'string') {
        const result = this.compress(msg.content);
        if (result.applied) {
          return { ...msg, content: result.compressed };
        }
        return msg;
      }

      // Handle array content (OpenAI format with tool results)
      if (Array.isArray(msg.content)) {
        const newContent = msg.content.map((part: any) => {
          if (part.type === 'text' && typeof part.text === 'string') {
            const result = this.compress(part.text);
            if (result.applied) {
              return { ...part, text: result.compressed };
            }
          }
          return part;
        });
        return { ...msg, content: newContent };
      }

      return msg;
    });
  }
}

export const toolCompressor = new ToolCompressor();
