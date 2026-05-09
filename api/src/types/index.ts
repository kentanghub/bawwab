export interface Provider {
  id: string;
  alias: string;
  name: string;
  type: 'oauth' | 'apikey' | 'cookie' | 'free';
  baseUrl: string;
  authType: 'bearer' | 'apikey' | 'cookie' | 'none';
  authHeader?: string;
  models: Model[];
  capabilities: Capability[];
  healthStatus: HealthStatus;
  latencyMs: number;
  successRate: number;
  costPer1kTokens: number;
  isEnabled: boolean;
  config?: Record<string, unknown>;
}

export interface Model {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsThinking: boolean;
  costPer1kInput: number;
  costPer1kOutput: number;
}

export type Capability =
  | 'llm'
  | 'embedding'
  | 'image'
  | 'imageToText'
  | 'tts'
  | 'stt'
  | 'webSearch'
  | 'webFetch'
  | 'video'
  | 'music';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastChecked: Date;
  lastError?: string;
  consecutiveFailures: number;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: string | object;
  response_format?: object;
  reasoning_effort?: 'none' | 'low' | 'medium' | 'high';
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatResponse {
  id: string;
  object: 'chat.completion' | 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Choice[];
  usage?: Usage;
}

export interface Choice {
  index: number;
  message?: Message;
  delta?: Partial<Message>;
  finish_reason: string | null;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface TokenOptimizerConfig {
  enabled: boolean;
  compressionLevel: 'light' | 'medium' | 'aggressive';
  deduplicateToolResults: boolean;
  slidingWindowEnabled: boolean;
  maxContextTokens: number;
  semanticChunking: boolean;
}

export interface RouteDecision {
  providerId: string;
  modelId: string;
  reasoning: string;
  estimatedCost: number;
  estimatedLatency: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  configSchema?: object;
}

export interface RequestLog {
  id: string;
  timestamp: Date;
  providerId: string;
  modelId: string;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  cacheHit?: boolean;
  error?: string;
  userAgent?: string;
  clientIp?: string;
  apiKey?: string;
}

export interface Team {
  id: string;
  name: string;
  apiKey: string;
  quota: Quota;
  settings: TeamSettings;
  members: string[];
}

export interface Quota {
  maxTokensPerMonth: number;
  maxRequestsPerMinute: number;
  maxCostPerMonth: number;
  usedTokens: number;
  usedCost: number;
}

export interface TeamSettings {
  allowedProviders: string[];
  blockedModels: string[];
  requireApproval: boolean;
  fallbackEnabled: boolean;
}
