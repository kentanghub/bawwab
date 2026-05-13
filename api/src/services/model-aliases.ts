/**
 * Model Alias System — resolve shorthand aliases to provider/model pairs.
 *
 * Resolution flow:
 *   1. If contains '/' → parse provider/model → resolve provider alias
 *   2. If no '/' → check DB aliases
 *   3. Fallback → infer from model name pattern
 */
import { getDb } from './database.js';

// ─── Hardcoded provider prefix aliases (30+) ─────────────────────────────
const PROVIDER_PREFIX_ALIASES: Record<string, string> = {
  // Coding / IDE providers
  cc: 'claude',
  cx: 'codex',
  gc: 'gemini-cli',
  qw: 'qwen',
  ag: 'antigravity',
  gh: 'github',
  kr: 'kiro',
  cu: 'cursor',
  kc: 'kilocode',
  kmc: 'kimi-coding',
  cl: 'cline',
  oc: 'opencode',
  ocg: 'opencode-go',
  cmc: 'commandcode',
  commandcode: 'commandcode',
  // API key providers
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
  openrouter: 'openrouter',
  ds: 'deepseek',
  deepseek: 'deepseek',
  glm: 'glm',
  kimi: 'kimi',
  minimax: 'minimax',
  'minimax-cn': 'minimax-cn',
  groq: 'groq',
  xai: 'xai',
  mistral: 'mistral',
  pplx: 'perplexity',
  perplexity: 'perplexity',
  together: 'together',
  fireworks: 'fireworks',
  cerebras: 'cerebras',
  cohere: 'cohere',
  nvidia: 'nvidia',
  nebius: 'nebius',
  siliconflow: 'siliconflow',
  hyp: 'hyperbolic',
  hyperbolic: 'hyperbolic',
  // TTS / STT
  el: 'elevenlabs',
  dg: 'deepgram',
  deepgram: 'deepgram',
  aai: 'assemblyai',
  assemblyai: 'assemblyai',
  polly: 'aws-polly',
  // Image / video
  fal: 'fal-ai',
  stability: 'stability-ai',
  bfl: 'black-forest-labs',
  recraft: 'recraft',
  topaz: 'topaz',
  runway: 'runwayml',
  runwayml: 'runwayml',
  // Cloud / infra
  vx: 'vertex',
  vertex: 'vertex',
  vxp: 'vertex-partner',
  cf: 'cloudflare-ai',
  // Web cookie providers
  gw: 'grok-web',
  pw: 'perplexity-web',
  mimo: 'xiaomi-mimo',
  // Embedding / rerank
  jina: 'jina-ai',
  // Free-tier / misc
  nb: 'nanobanana',
  ch: 'chutes',
  chutes: 'chutes',
  ark: 'volcengine-ark',
  byteplus: 'byteplus',
  bpm: 'byteplus',
  cursor: 'cursor',
  agentrouter: 'agentrouter',
  aimlapi: 'aimlapi',
  aiml: 'aimlapi',
  novita: 'novita',
  modal: 'modal',
  mdl: 'modal',
  reka: 'reka',
  nlpcloud: 'nlpcloud',
  nlpc: 'nlpcloud',
  bazaarlink: 'bazaarlink',
  bzl: 'bazaarlink',
  completions: 'completions',
  cpl: 'completions',
  enally: 'enally',
  enly: 'enally',
  freetheai: 'freetheai',
  fta: 'freetheai',
  llm7: 'llm7',
  lepton: 'lepton',
  kluster: 'kluster',
  ai21: 'ai21',
  'inference-net': 'inference-net',
  inet: 'inference-net',
  predibase: 'predibase',
  bytez: 'bytez',
  morph: 'morph',
  longcat: 'longcat',
  lc: 'longcat',
  puter: 'puter',
  pu: 'puter',
  uncloseai: 'uncloseai',
  unc: 'uncloseai',
  scaleway: 'scaleway',
  scw: 'scaleway',
  deepinfra: 'deepinfra',
  sambanova: 'sambanova',
  samba: 'sambanova',
  nscale: 'nscale',
  baseten: 'baseten',
  publicai: 'publicai',
  'nous-research': 'nous-research',
  nous: 'nous-research',
  glhf: 'glhf',
};

// ─── Model-name inference rules ──────────────────────────────────────────
const MODEL_NAME_PATTERNS: Array<[RegExp, string]> = [
  [/^claude-/i, 'anthropic'],
  [/^gemini-/i, 'gemini'],
  [/^gpt-/i, 'openai'],
  [/^o[1-9]/i, 'openai'],
  [/^deepseek-/i, 'deepseek'],
  [/^qwen/i, 'qwen'],
  [/^kimi/i, 'kimi'],
  [/^glm-/i, 'glm'],
  [/^minimax/i, 'minimax'],
  [/^grok/i, 'xai'],
  [/^mistral/i, 'mistral'],
  [/^command-/i, 'anthropic'],
  [/^codex/i, 'openai'],
];

function resolveProviderAlias(alias: string): string {
  return PROVIDER_PREFIX_ALIASES[alias] || alias;
}

function inferProviderFromModelName(model: string): string {
  const m = model.toLowerCase();
  for (const [pattern, provider] of MODEL_NAME_PATTERNS) {
    if (pattern.test(m)) return provider;
  }
  return 'openai'; // default fallback
}

// ─── Manager ─────────────────────────────────────────────────────────────

function getAllDbAliases(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT alias, target FROM model_aliases').all() as Array<{ alias: string; target: string }>;
  const map: Record<string, string> = {};
  for (const row of rows) map[row.alias] = row.target;
  return map;
}

export const modelAliasManager = {
  /**
   * Resolve a model string to { provider, model }.
   *
   * Flow:
   *   1. Contains '/' → parse providerPart/modelPart → resolve provider alias
   *   2. No '/' → check DB aliases (may produce "provider/model") → recurse
   *   3. Fallback → infer provider from model name pattern
   */
  resolveAlias(modelStr: string): { provider: string; model: string } {
    if (!modelStr) return { provider: 'openai', model: '' };

    // Step 1: slash-separated
    if (modelStr.includes('/')) {
      const firstSlash = modelStr.indexOf('/');
      const providerPart = modelStr.slice(0, firstSlash);
      const modelPart = modelStr.slice(firstSlash + 1);
      const provider = resolveProviderAlias(providerPart);
      return { provider, model: modelPart };
    }

    // Step 2: check DB aliases
    const dbAliases = getAllDbAliases();
    if (dbAliases[modelStr]) {
      // Alias target can be "provider/model" or just "model"
      const target = dbAliases[modelStr];
      if (target.includes('/')) {
        const firstSlash = target.indexOf('/');
        return {
          provider: resolveProviderAlias(target.slice(0, firstSlash)),
          model: target.slice(firstSlash + 1),
        };
      }
      // If target has no slash, it's a model name — infer provider
      return { provider: inferProviderFromModelName(target), model: target };
    }

    // Step 3: infer from model name
    return { provider: inferProviderFromModelName(modelStr), model: modelStr };
  },

  /** Set a user-configurable alias */
  setAlias(alias: string, target: string): void {
    const db = getDb();
    db.prepare(
      'INSERT INTO model_aliases (alias, target) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET target = excluded.target'
    ).run(alias, target);
  },

  /** Remove a user-configurable alias */
  removeAlias(alias: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM model_aliases WHERE alias = ?').run(alias);
    return result.changes > 0;
  },

  /** List all aliases (DB only — hardcoded are internal) */
  listAliases(): Array<{ alias: string; target: string }> {
    const db = getDb();
    return db.prepare('SELECT alias, target, created_at FROM model_aliases ORDER BY alias').all() as any[];
  },

  /** Expose the provider prefix map for read-only inspection */
  getProviderPrefixAliases(): Record<string, string> {
    return { ...PROVIDER_PREFIX_ALIASES };
  },
};
