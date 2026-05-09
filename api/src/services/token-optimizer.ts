import type { ChatRequest, Message, TokenOptimizerConfig } from '../types/index.js';

class TokenOptimizer {
  private config: TokenOptimizerConfig = {
    enabled: true,
    compressionLevel: 'medium',
    deduplicateToolResults: true,
    slidingWindowEnabled: true,
    maxContextTokens: 128000,
    semanticChunking: true
  };

  initialize(): void {
    // Load config from env or DB
    const envConfig = process.env.TOKEN_OPTIMIZER_CONFIG;
    if (envConfig) {
      try {
        this.config = { ...this.config, ...JSON.parse(envConfig) };
      } catch {
        console.warn('Invalid TOKEN_OPTIMIZER_CONFIG');
      }
    }
  }

  optimize(request: ChatRequest): ChatRequest {
    if (!this.config.enabled) return request;

    let messages = [...request.messages];
    
    // 1. Deduplicate tool results
    if (this.config.deduplicateToolResults) {
      messages = this.deduplicateToolResults(messages);
    }

    // 2. Compress content based on level
    messages = messages.map(m => ({
      ...m,
      content: this.compressContent(m.content)
    }));

    // 3. Apply sliding window if enabled
    if (this.config.slidingWindowEnabled) {
      messages = this.applySlidingWindow(messages);
    }

    // 4. Semantic chunking for long content
    if (this.config.semanticChunking) {
      messages = this.applySemanticChunking(messages);
    }

    return { ...request, messages };
  }

  private deduplicateToolResults(messages: Message[]): Message[] {
    const seen = new Map<string, number>();
    
    return messages.filter((msg, index) => {
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        const hash = this.hashContent(msg.content);
        if (seen.has(hash)) {
          return false;
        }
        seen.set(hash, index);
      }
      return true;
    });
  }

  private compressContent(content: string | any[]): string | any[] {
    if (typeof content !== 'string') return content;

    switch (this.config.compressionLevel) {
      case 'light':
        return this.lightCompress(content);
      case 'medium':
        return this.mediumCompress(content);
      case 'aggressive':
        return this.aggressiveCompress(content);
      default:
        return content;
    }
  }

  private lightCompress(content: string): string {
    // Remove excessive whitespace and redundant lines
    return content
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  private mediumCompress(content: string): string {
    let compressed = this.lightCompress(content);
    
    // Truncate repetitive patterns (like stack traces, diffs)
    compressed = this.truncateRepetitivePatterns(compressed);
    
    // Compress base64/images
    compressed = compressed.replace(
      /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g,
      '[base64_image_truncated]'
    );
    
    return compressed;
  }

  private aggressiveCompress(content: string): string {
    let compressed = this.mediumCompress(content);
    
    // Summarize long text blocks (>2000 chars)
    if (compressed.length > 2000) {
      compressed = this.summarizeText(compressed);
    }
    
    return compressed;
  }

  private truncateRepetitivePatterns(content: string): string {
    // Truncate long repeating sequences
    const lines = content.split('\n');
    const result: string[] = [];
    let repeatCount = 0;
    let lastLine = '';
    
    for (const line of lines) {
      if (line === lastLine) {
        repeatCount++;
        if (repeatCount === 3) {
          result.push('... (repeated lines truncated)');
        }
        continue;
      }
      repeatCount = 0;
      lastLine = line;
      result.push(line);
    }
    
    return result.join('\n');
  }

  private summarizeText(content: string): string {
    // Simple summarization - keep first 500 and last 300 chars
    const maxLen = 1000;
    if (content.length <= maxLen) return content;
    
    const prefix = content.slice(0, 500);
    const suffix = content.slice(-300);
    return `${prefix}\n\n... [${content.length - 800} characters truncated] ...\n\n${suffix}`;
  }

  private applySlidingWindow(messages: Message[]): Message[] {
    // Keep system message, last N messages, summarize older ones
    const MAX_MESSAGES = 20;
    
    if (messages.length <= MAX_MESSAGES) return messages;
    
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    
    if (nonSystemMessages.length <= MAX_MESSAGES - systemMessages.length) {
      return messages;
    }
    
    const keepCount = MAX_MESSAGES - systemMessages.length;
    const recentMessages = nonSystemMessages.slice(-keepCount);
    
    return [...systemMessages, ...recentMessages];
  }

  private applySemanticChunking(messages: Message[]): Message[] {
    // Group related messages and merge if they're too short
    const result: Message[] = [];
    
    for (const msg of messages) {
      const lastMsg = result[result.length - 1];
      
      if (
        lastMsg &&
        lastMsg.role === msg.role &&
        typeof lastMsg.content === 'string' &&
        typeof msg.content === 'string' &&
        lastMsg.content.length < 500
      ) {
        lastMsg.content = `${lastMsg.content}\n\n${msg.content}`;
      } else {
        result.push({ ...msg });
      }
    }
    
    return result;
  }

  private hashContent(content: string): string {
    // Simple hash for deduplication
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  getConfig(): TokenOptimizerConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<TokenOptimizerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export const tokenOptimizer = new TokenOptimizer();
