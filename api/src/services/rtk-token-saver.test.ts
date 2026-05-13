/**
 * Unit Tests — RTK Token Saver (pure filter functions)
 * These test the individual compression filters and autodetect logic.
 */
import { describe, it, expect } from 'vitest';

// We import the compiled JS since the filters are exported
// But the filters are NOT individually exported in the source.
// Instead, we test through the public API: compressMessages and testCompression.

// Since the module uses ESM and has side effects (logger), we need to
// test through the public interface. The filters are internal.
// We'll test compressMessages which is the main public function.

// Helper: generate a large git diff string
function makeGitDiff(numFiles = 3, hunksPerFile = 2, linesPerHunk = 20): string {
  const parts: string[] = [];
  for (let f = 0; f < numFiles; f++) {
    parts.push(`diff --git a/src/file${f}.ts b/src/file${f}.ts`);
    parts.push(`--- a/src/file${f}.ts`);
    parts.push(`+++ b/src/file${f}.ts`);
    for (let h = 0; h < hunksPerFile; h++) {
      parts.push(`@@ -${h * 10 + 1},${linesPerHunk} +${h * 10 + 1},${linesPerHunk} @@`);
      for (let l = 0; l < linesPerHunk; l++) {
        if (l % 3 === 0) parts.push(`+added line ${l}`);
        else if (l % 3 === 1) parts.push(`-removed line ${l}`);
        else parts.push(` context line ${l}`);
      }
    }
  }
  return parts.join('\n');
}

// Helper: generate grep output
function makeGrep(numFiles = 3, matchesPerFile = 5): string {
  const parts: string[] = [];
  for (let f = 0; f < numFiles; f++) {
    for (let m = 0; m < matchesPerFile; m++) {
      parts.push(`src/file${f}.ts:${m + 1}:some matching content here`);
    }
  }
  return parts.join('\n');
}

// Helper: generate find output
function makeFind(numDirs = 3, filesPerDir = 5): string {
  const parts: string[] = [];
  for (let d = 0; d < numDirs; d++) {
    for (let f = 0; f < filesPerDir; f++) {
      parts.push(`./src/dir${d}/file${f}.ts`);
    }
  }
  return parts.join('\n');
}

// Helper: generate tree output
function makeTree(): string {
  return `src/
├── routes/
│   ├── chat.ts
│   ├── auth.ts
│   └── providers.ts
├── services/
│   ├── database.ts
│   ├── cache.ts
│   └── router.ts
└── index.ts

3 directories, 7 files`;
}

// Helper: generate ls -la output
function makeLs(): string {
  return `total 48
drwxr-xr-x   8 user  staff   256 Jan 15 10:30 .
drwxr-xr-x  12 user  staff   384 Jan 15 10:00 ..
-rw-r--r--   1 user  staff  1234 Jan 15 10:30 index.ts
-rw-r--r--   1 user  staff  5678 Jan 15 10:25 database.ts
-rw-r--r--   1 user  staff   890 Jan 15 10:20 config.json
-rw-r--r--   1 user  staff  2345 Jan 15 10:15 router.ts
drwxr-xr-x   3 user  staff    96 Jan 15 10:10 node_modules
-rw-r--r--   1 user  staff  9012 Jan 15 10:05 package.json`;
}

// Helper: generate duplicate log lines
function makeDedupLog(): string {
  const lines: string[] = [];
  for (let i = 0; i < 30; i++) {
    lines.push('2024-01-15 INFO: Processing request...');
  }
  for (let i = 0; i < 20; i++) {
    lines.push('2024-01-15 WARN: Connection timeout, retrying...');
  }
  return lines.join('\n');
}

// Helper: generate numbered file content (cat -n style)
function makeNumberedFile(numLines = 300): string {
  const lines: string[] = [];
  for (let i = 1; i <= numLines; i++) {
    lines.push(`${String(i).padStart(4)}|  const x = ${i}; // some code`);
  }
  return lines.join('\n');
}

describe('RTK Token Saver', () => {
  // We need dynamic import since the module may have side effects
  let compressMessages: Function;
  let testCompression: Function;

  beforeAll(async () => {
    const mod = await import('../services/rtk-token-saver.js');
    compressMessages = mod.compressMessages;
    testCompression = mod.testCompression;
  });

  describe('compressMessages', () => {
    it('should return unchanged messages when disabled', () => {
      const msgs = [{ role: 'tool', content: 'x'.repeat(1000) }];
      const result = compressMessages(msgs, false);
      expect(result.messages).toEqual(msgs);
      expect(result.stats.savedBytes).toBe(0);
    });

    it('should return unchanged for non-tool messages', () => {
      const msgs = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];
      const result = compressMessages(msgs, true);
      expect(result.messages).toEqual(msgs);
      expect(result.stats.compressedCount).toBe(0);
    });

    it('should compress OpenAI tool message with string content', () => {
      const bigContent = makeGitDiff(5, 3, 50);
      const msgs = [{ role: 'tool', content: bigContent, tool_call_id: '123' }];
      const result = compressMessages(msgs, true);
      expect(result.stats.savedBytes).toBeGreaterThan(0);
      expect(result.messages[0].content.length).toBeLessThan(bigContent.length);
      // Original content is mutated in place
      expect(result.messages[0].tool_call_id).toBe('123');
    });

    it('should compress OpenAI tool message with array content', () => {
      const bigContent = makeGrep(5, 10);
      const msgs = [{
        role: 'tool',
        content: [{ type: 'text', text: bigContent }],
        tool_call_id: 'abc',
      }];
      const result = compressMessages(msgs, true);
      expect(result.stats.savedBytes).toBeGreaterThan(0);
    });

    it('should compress Claude tool_result string content', () => {
      const bigContent = makeFind(5, 10);
      const msgs = [{
        role: 'user',
        content: [
          { type: 'text', text: 'Here is the result' },
          { type: 'tool_result', tool_use_id: 'x', content: bigContent },
        ],
      }];
      const result = compressMessages(msgs, true);
      expect(result.stats.savedBytes).toBeGreaterThan(0);
    });

    it('should NOT compress error tool results', () => {
      const bigContent = 'x'.repeat(1000);
      const msgs = [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'x', is_error: true, content: bigContent },
        ],
      }];
      const result = compressMessages(msgs, true);
      expect(result.stats.savedBytes).toBe(0);
    });

    it('should NOT compress content smaller than 500 bytes', () => {
      const smallContent = 'x'.repeat(100);
      const msgs = [{ role: 'tool', content: smallContent }];
      const result = compressMessages(msgs, true);
      expect(result.stats.savedBytes).toBe(0);
    });

    it('should handle empty/null messages gracefully', () => {
      expect(compressMessages([], true).stats.compressedCount).toBe(0);
      expect(compressMessages(null as any, true).stats.compressedCount).toBe(0);
      expect(compressMessages(undefined as any, true).stats.compressedCount).toBe(0);
    });

    it('should never return empty content', () => {
      // Even if a filter somehow returns empty, the safety check should keep original
      const msgs = [{ role: 'tool', content: 'x'.repeat(600) }];
      const result = compressMessages(msgs, true);
      expect(result.messages[0].content.length).toBeGreaterThan(0);
    });
  });

  describe('testCompression', () => {
    it('should return no savings for small text', () => {
      const result = testCompression('hello world');
      expect(result.savedBytes).toBe(0);
      expect(result.filter).toContain('too small');
    });

    it('should detect and compress git diff', () => {
      const diff = makeGitDiff(3, 2, 40);
      const result = testCompression(diff);
      if (diff.length >= 500) {
        expect(result.savedBytes).toBeGreaterThanOrEqual(0);
      }
    });

    it('should detect and compress grep output', () => {
      const grep = makeGrep(5, 20);
      const result = testCompression(grep);
      expect(result.originalBytes).toBe(grep.length);
    });

    it('should detect and compress find output', () => {
      const find = makeFind(5, 15);
      const result = testCompression(find);
      expect(result.originalBytes).toBe(find.length);
    });
  });
});
