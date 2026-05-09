/**
 * Content Safety Layer
 * - PII detection & redaction
 * - Toxicity / profanity filtering
 * - Prompt injection detection
 */

import { logger } from './logger.js';

// Common PII patterns
const PII_PATTERNS = [
  { type: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'phone', regex: /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  { type: 'credit_card', regex: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g },
];

// Common prompt injection patterns
const INJECTION_PATTERNS = [
  /ignore previous instructions/i,
  /disregard.*(prompt|instruction)/i,
  /you are now.*(DAN|jailbreak)/i,
  /system prompt.*leak/i,
  /repeat.*words.*back/i,
  /output.*initialization/i,
];

// Simple profanity list (truncated for brevity — expand in production)
const TOXIC_WORDS = new Set([
  'hate', 'kill', 'die', 'racist', 'nazi', 'terrorist', 'bomb', 'shoot',
]);

class ContentSafety {
  /**
   * Scan and redact PII from text
   */
  redactPII(text: string): { text: string; detected: string[] } {
    let result = text;
    const detected: string[] = [];

    for (const pattern of PII_PATTERNS) {
      const matches = text.match(pattern.regex);
      if (matches) {
        detected.push(...matches.map(m => `${pattern.type}: ${m.slice(0, 4)}...`));
        result = result.replace(pattern.regex, `[REDACTED_${pattern.type.toUpperCase()}]`);
      }
    }

    return { text: result, detected };
  }

  /**
   * Detect prompt injection attempts
   */
  detectInjection(text: string): { detected: boolean; score: number; matches: string[] } {
    const matches: string[] = [];
    let score = 0;

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        matches.push(pattern.source.slice(0, 30));
        score += 0.25;
      }
    }

    // Check for excessive repetition (common in injection)
    const words = text.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    if (uniqueWords.size / words.length < 0.3 && words.length > 20) {
      score += 0.3;
      matches.push('low_entropy');
    }

    return { detected: score >= 0.5, score: Math.min(1, score), matches };
  }

  /**
   * Basic toxicity detection
   */
  detectToxicity(text: string): { toxic: boolean; score: number; words: string[] } {
    const words = text.toLowerCase().split(/[^a-z]+/);
    const found = words.filter(w => TOXIC_WORDS.has(w));
    const score = Math.min(1, found.length / 3);
    return { toxic: score > 0.3, score, words: found };
  }

  /**
   * Full safety scan on request
   */
  scanRequest(messages: Array<{ role: string; content: any }>): {
    safe: boolean;
    piiRedacted: boolean;
    injectionDetected: boolean;
    toxicDetected: boolean;
    redactedMessages: typeof messages;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let piiRedacted = false;
    let injectionDetected = false;
    let toxicDetected = false;

    const redactedMessages = messages.map(msg => {
      if (typeof msg.content !== 'string') return msg;

      // PII redaction
      const pii = this.redactPII(msg.content);
      if (pii.detected.length > 0) {
        piiRedacted = true;
        warnings.push(`PII redacted: ${pii.detected.join(', ')}`);
      }

      // Injection detection
      const injection = this.detectInjection(pii.text);
      if (injection.detected) {
        injectionDetected = true;
        warnings.push(`Prompt injection detected (score: ${injection.score.toFixed(2)})`);
      }

      // Toxicity
      const toxicity = this.detectToxicity(pii.text);
      if (toxicity.toxic) {
        toxicDetected = true;
        warnings.push(`Toxic content detected: ${toxicity.words.join(', ')}`);
      }

      return { ...msg, content: pii.text };
    });

    const safe = !injectionDetected && !toxicDetected;

    if (!safe) {
      logger.warn({ warnings }, '[ContentSafety] Unsafe content detected');
    }

    return { safe, piiRedacted, injectionDetected, toxicDetected, redactedMessages, warnings };
  }
}

export const contentSafety = new ContentSafety();
