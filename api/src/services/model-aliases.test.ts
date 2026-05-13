/**
 * Unit Tests — Model Alias Resolution
 * Tests the prefix alias system and model name inference.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Set up a temp test database
const testDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bawwab-alias-test-'));
process.env.BAWWAB_DATA_DIR = testDbDir;

const { initDatabase, closeDb, getDb } = await import('../services/database.js');
initDatabase();

const { modelAliasManager } = await import('../services/model-aliases.js');

describe('Model Alias Manager', () => {
  describe('resolveAlias — prefix parsing', () => {
    it('should parse cc/claude-3-opus as anthropic + claude-3-opus', () => {
      const result = modelAliasManager.resolveAlias('cc/claude-3-opus');
      expect(result.provider).toBe('claude');
      expect(result.model).toBe('claude-3-opus');
    });

    it('should parse openai/gpt-4o correctly', () => {
      const result = modelAliasManager.resolveAlias('openai/gpt-4o');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
    });

    it('should parse ds/deepseek-chat correctly', () => {
      const result = modelAliasManager.resolveAlias('ds/deepseek-chat');
      expect(result.provider).toBe('deepseek');
      expect(result.model).toBe('deepseek-chat');
    });

    it('should parse groq/llama-3.3-70b-versatile correctly', () => {
      const result = modelAliasManager.resolveAlias('groq/llama-3.3-70b-versatile');
      expect(result.provider).toBe('groq');
      expect(result.model).toBe('llama-3.3-70b-versatile');
    });

    it('should parse kr/model as kiro + model', () => {
      const result = modelAliasManager.resolveAlias('kr/some-model');
      expect(result.provider).toBe('kiro');
      expect(result.model).toBe('some-model');
    });

    it('should handle multi-slash model names', () => {
      const result = modelAliasManager.resolveAlias('openrouter/meta-llama/llama-3.3-70b');
      expect(result.provider).toBe('openrouter');
      expect(result.model).toBe('meta-llama/llama-3.3-70b');
    });

    it('should pass through unknown provider prefixes', () => {
      const result = modelAliasManager.resolveAlias('unknown-provider/some-model');
      expect(result.provider).toBe('unknown-provider');
      expect(result.model).toBe('some-model');
    });
  });

  describe('resolveAlias — model name inference (no slash)', () => {
    it('should infer anthropic from claude-*', () => {
      const result = modelAliasManager.resolveAlias('claude-3-opus');
      expect(result.provider).toBe('anthropic');
    });

    it('should infer openai from gpt-*', () => {
      const result = modelAliasManager.resolveAlias('gpt-4o');
      expect(result.provider).toBe('openai');
    });

    it('should infer openai from o1/o3', () => {
      const result = modelAliasManager.resolveAlias('o1-preview');
      expect(result.provider).toBe('openai');
    });

    it('should infer gemini from gemini-*', () => {
      const result = modelAliasManager.resolveAlias('gemini-pro');
      expect(result.provider).toBe('gemini');
    });

    it('should infer deepseek from deepseek-*', () => {
      const result = modelAliasManager.resolveAlias('deepseek-chat');
      expect(result.provider).toBe('deepseek');
    });

    it('should infer xai from grok-*', () => {
      const result = modelAliasManager.resolveAlias('grok-2');
      expect(result.provider).toBe('xai');
    });

    it('should default to openai for unknown model names', () => {
      const result = modelAliasManager.resolveAlias('totally-unknown-model');
      expect(result.provider).toBe('openai');
    });
  });

  describe('resolveAlias — edge cases', () => {
    it('should return openai/empty for empty string', () => {
      const result = modelAliasManager.resolveAlias('');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('');
    });

    it('should handle canopywave/moonshotai/kimi-k2.6', () => {
      const result = modelAliasManager.resolveAlias('canopywave/moonshotai/kimi-k2.6');
      expect(result.provider).toBe('canopywave');
      expect(result.model).toBe('moonshotai/kimi-k2.6');
    });
  });

  describe('DB aliases', () => {
    it('should set and resolve DB aliases', () => {
      modelAliasManager.setAlias('fast', 'groq/llama-3.3-70b-versatile');
      const result = modelAliasManager.resolveAlias('fast');
      expect(result.provider).toBe('groq');
      expect(result.model).toBe('llama-3.3-70b-versatile');
    });

    it('should list DB aliases', () => {
      modelAliasManager.setAlias('test-alias', 'openai/gpt-4o');
      const aliases = modelAliasManager.listAliases();
      expect(aliases.length).toBeGreaterThanOrEqual(1);
      expect(aliases.some((a: any) => a.alias === 'test-alias')).toBe(true);
    });

    it('should remove DB aliases', () => {
      modelAliasManager.setAlias('to-remove', 'openai/gpt-4o');
      const removed = modelAliasManager.removeAlias('to-remove');
      expect(removed).toBe(true);
    });

    it('should overwrite existing alias', () => {
      modelAliasManager.setAlias('overwrite-test', 'openai/gpt-4o');
      modelAliasManager.setAlias('overwrite-test', 'anthropic/claude-3-opus');
      const result = modelAliasManager.resolveAlias('overwrite-test');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-3-opus');
    });
  });

  describe('getProviderPrefixAliases', () => {
    it('should return all prefix aliases', () => {
      const aliases = modelAliasManager.getProviderPrefixAliases();
      expect(aliases['cc']).toBe('claude');
      expect(aliases['openai']).toBe('openai');
      expect(aliases['ds']).toBe('deepseek');
      expect(aliases['groq']).toBe('groq');
      expect(Object.keys(aliases).length).toBeGreaterThan(30);
    });
  });
});

afterAll(() => {
  closeDb();
  fs.rmSync(testDbDir, { recursive: true, force: true });
});
