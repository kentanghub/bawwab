/**
 * Format Translator
 * Converts between OpenAI, Claude (Anthropic), and Gemini formats
 * so any AI tool can connect regardless of native format.
 *
 * Supported conversions:
 * - OpenAI ↔ Claude (Anthropic Messages API)
 * - OpenAI ↔ Gemini (Google Generative Language API)
 */

import { logger } from './logger.js';

export type ApiFormat = 'openai' | 'claude' | 'gemini';

export interface TranslationOptions {
  stripSystemMessage?: boolean; // Claude doesn't allow system in messages array
  addCavemanPrompt?: boolean;   // Week 4 feature
}

export class FormatTranslator {
  /**
   * Detect API format from provider ID
   */
  detectFormat(providerId: string): ApiFormat {
    const claudeProviders = ['anthropic'];
    const geminiProviders = ['gemini'];

    if (claudeProviders.includes(providerId)) return 'claude';
    if (geminiProviders.includes(providerId)) return 'gemini';
    return 'openai'; // Default - most providers use OpenAI-compatible format
  }

  /**
   * Translate request FROM OpenAI format TO provider's native format
   */
  translateRequest(
    openaiRequest: any,
    targetFormat: ApiFormat,
    options: TranslationOptions = {}
  ): any {
    switch (targetFormat) {
      case 'claude':
        return this.toClaude(openaiRequest, options);
      case 'gemini':
        return this.toGemini(openaiRequest, options);
      default:
        return openaiRequest;
    }
  }

  /**
   * Translate response FROM provider's native format TO OpenAI format
   */
  translateResponse(
    nativeResponse: any,
    sourceFormat: ApiFormat
  ): any {
    switch (sourceFormat) {
      case 'claude':
        return this.fromClaude(nativeResponse);
      case 'gemini':
        return this.fromGemini(nativeResponse);
      default:
        return nativeResponse;
    }
  }

  // ─── OpenAI → Claude ───

  private toClaude(openaiReq: any, options: TranslationOptions): any {
    const messages = openaiReq.messages || [];
    const systemMessage = messages.find((m: any) => m.role === 'system');
    const nonSystemMessages = messages.filter((m: any) => m.role !== 'system');

    // Claude uses top-level "system" param, not system message in array
    const result: any = {
      model: openaiReq.model,
      messages: nonSystemMessages.map((m: any) => this.convertOpenAIMessageToClaude(m)),
      max_tokens: openaiReq.max_tokens || 4096,
      stream: openaiReq.stream || false,
    };

    if (systemMessage) {
      result.system = this.extractTextContent(systemMessage.content);
    }

    // Caveman mode (Week 4)
    if (options.addCavemanPrompt) {
      const cavemanSystem = 'You are a caveman. Talk in short, terse sentences. Use simple words. No fluff. Get to the point immediately.';
      result.system = result.system
        ? `${result.system}\n\n${cavemanSystem}`
        : cavemanSystem;
    }

    if (openaiReq.temperature !== undefined) {
      result.temperature = openaiReq.temperature;
    }

    // Convert tools
    if (openaiReq.tools && openaiReq.tools.length > 0) {
      result.tools = openaiReq.tools.map((t: any) => ({
        name: t.function?.name || t.name,
        description: t.function?.description || t.description,
        input_schema: {
          type: 'object',
          properties: t.function?.parameters?.properties || t.parameters?.properties || {},
          required: t.function?.parameters?.required || t.parameters?.required || [],
        },
      }));
    }

    return result;
  }

  private convertOpenAIMessageToClaude(msg: any): any {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const content = this.extractTextContent(msg.content);

    // Handle tool_use / tool_result
    if (msg.role === 'tool') {
      return {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content,
        }],
      };
    }

    if (msg.tool_calls) {
      return {
        role: 'assistant',
        content: msg.tool_calls.map((tc: any) => ({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name,
          input: JSON.parse(tc.function?.arguments || '{}'),
        })),
      };
    }

    return { role, content };
  }

  // ─── Claude → OpenAI ───

  private fromClaude(claudeRes: any): any {
    const content = claudeRes.content || [];
    const textBlocks = content.filter((c: any) => c.type === 'text');
    const toolUseBlocks = content.filter((c: any) => c.type === 'tool_use');

    const openaiRes: any = {
      id: claudeRes.id || `claude-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: claudeRes.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textBlocks.map((t: any) => t.text).join('\n') || null,
        },
        finish_reason: this.mapClaudeStopReason(claudeRes.stop_reason),
      }],
      usage: {
        prompt_tokens: claudeRes.usage?.input_tokens || 0,
        completion_tokens: claudeRes.usage?.output_tokens || 0,
        total_tokens: (claudeRes.usage?.input_tokens || 0) + (claudeRes.usage?.output_tokens || 0),
      },
    };

    // Add tool_calls if present
    if (toolUseBlocks.length > 0) {
      openaiRes.choices[0].message.tool_calls = toolUseBlocks.map((tc: any) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.input || {}),
        },
      }));
    }

    return openaiRes;
  }

  private mapClaudeStopReason(reason: string): string {
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'max_tokens': return 'length';
      case 'stop_sequence': return 'stop';
      case 'tool_use': return 'tool_calls';
      default: return 'stop';
    }
  }

  // ─── OpenAI → Gemini ───

  private toGemini(openaiReq: any, options: TranslationOptions): any {
    const messages = openaiReq.messages || [];
    const systemMessage = messages.find((m: any) => m.role === 'system');
    const nonSystemMessages = messages.filter((m: any) => m.role !== 'system');

    const contents = nonSystemMessages.map((m: any) => this.convertOpenAIMessageToGemini(m));

    const result: any = {
      contents,
      generationConfig: {
        maxOutputTokens: openaiReq.max_tokens || 4096,
        temperature: openaiReq.temperature ?? 0.7,
      },
    };

    if (systemMessage) {
      result.systemInstruction = {
        parts: [{ text: this.extractTextContent(systemMessage.content) }],
      };
    }

    // Caveman mode
    if (options.addCavemanPrompt) {
      const cavemanSystem = 'You are a caveman. Talk in short, terse sentences. Use simple words. No fluff. Get to the point immediately.';
      const existing = result.systemInstruction?.parts?.[0]?.text || '';
      result.systemInstruction = {
        parts: [{ text: existing ? `${existing}\n\n${cavemanSystem}` : cavemanSystem }],
      };
    }

    return result;
  }

  private convertOpenAIMessageToGemini(msg: any): any {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts: any[] = [];

    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else if (part.type === 'image_url') {
          parts.push({
            inlineData: {
              mimeType: 'image/jpeg',
              data: part.image_url?.url?.split(',')[1] || part.image_url?.url,
            },
          });
        }
      }
    }

    return { role, parts };
  }

  // ─── Gemini → OpenAI ───

  private fromGemini(geminiRes: any): any {
    const candidates = geminiRes.candidates || [];
    const first = candidates[0];
    const content = first?.content?.parts?.map((p: any) => p.text).join('') || '';

    const usage = geminiRes.usageMetadata || {};

    return {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gemini',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: first?.finishReason === 'STOP' ? 'stop' : 'length',
      }],
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: (usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0),
      },
    };
  }

  // ─── Helpers ───

  private extractTextContent(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
    return '';
  }
}

export const formatTranslator = new FormatTranslator();
