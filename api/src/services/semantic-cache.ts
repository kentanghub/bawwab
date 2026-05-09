/**
 * Semantic Cache
 * Cache responses based on embedding similarity (not exact hash match).
 * Uses simple cosine similarity on text embeddings (or fallback to string similarity).
 * When a prompt is "similar enough" to a cached prompt, return cached response.
 */

import { logger } from './logger.js';

export interface CacheEntry {
  id: string;
  prompt: string;
  response: any;
  embedding: number[];
  createdAt: Date;
  hitCount: number;
  ttlSeconds: number;
}

// Simple in-memory semantic cache
const cacheStore: Map<string, CacheEntry> = new Map();

class SemanticCache {
  private similarityThreshold = 0.92; // 92% similar

  /**
   * Get cached response for a prompt if similarity >= threshold
   */
  async get(prompt: string): Promise<any | null> {
    const promptEmbedding = this.embed(prompt);
    let bestMatch: CacheEntry | null = null;
    let bestScore = 0;

    const now = Date.now();
    for (const [id, entry] of Array.from(cacheStore.entries())) {
      // Expire old entries
      if (now - entry.createdAt.getTime() > entry.ttlSeconds * 1000) {
        cacheStore.delete(id);
        continue;
      }

      const score = this.cosineSimilarity(promptEmbedding, entry.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    if (bestMatch && bestScore >= this.similarityThreshold) {
      bestMatch.hitCount++;
      logger.info(`[SemanticCache] Hit (score: ${bestScore.toFixed(3)})`);
      return bestMatch.response;
    }

    return null;
  }

  /**
   * Store response in semantic cache
   */
  async set(prompt: string, response: any, ttlSeconds: number = 300): Promise<void> {
    const id = `sem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const embedding = this.embed(prompt);

    const entry: CacheEntry = {
      id,
      prompt,
      response,
      embedding,
      createdAt: new Date(),
      hitCount: 0,
      ttlSeconds,
    };

    cacheStore.set(id, entry);

    // Trim cache if too large (>1000 entries)
    if (cacheStore.size > 1000) {
      const oldest = Array.from(cacheStore.values()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (oldest) cacheStore.delete(oldest.id);
    }
  }

  /**
   * Get cache stats
   */
  getStats(): { entries: number; totalHits: number } {
    const entries = Array.from(cacheStore.values());
    return {
      entries: entries.length,
      totalHits: entries.reduce((sum, e) => sum + e.hitCount, 0),
    };
  }

  /**
   * Simple text embedding using character n-gram frequencies
   * In production, replace with real embedding model (e.g. openai text-embedding-3-small)
   */
  private embed(text: string): number[] {
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const words = normalized.split(/\s+/).slice(0, 50); // limit to 50 words
    const vec = new Array(128).fill(0);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      for (let j = 0; j < word.length; j++) {
        const idx = (word.charCodeAt(j) + i * 7 + j * 13) % 128;
        vec[idx] += 1;
      }
    }

    // Normalize
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vec;
    return vec.map(v => v / magnitude);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
  }
}

export const semanticCache = new SemanticCache();
