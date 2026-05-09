import { z } from 'zod';

export const contentPartSchema = z.object({
  type: z.enum(['text', 'image_url']),
  text: z.string().optional(),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(['auto', 'low', 'high']).optional()
  }).optional()
});

export const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(contentPartSchema)]),
  name: z.string().optional(),
  tool_calls: z.array(z.any()).optional(),
  tool_call_id: z.string().optional()
});

export const toolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.any())
  })
});

export const chatRequestSchema = z.object({
  model: z.string().min(1, 'Model is required'),
  messages: z.array(messageSchema).min(1, 'At least one message is required'),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional().default(false),
  tools: z.array(toolSchema).optional(),
  tool_choice: z.union([z.string(), z.record(z.any())]).optional(),
  response_format: z.record(z.any()).optional(),
  reasoning_effort: z.enum(['none', 'low', 'medium', 'high']).optional()
});

export const chatCompletionSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional(),
  tools: z.array(z.any()).optional(),
  tool_choice: z.any().optional()
});

export type ValidatedChatRequest = z.infer<typeof chatRequestSchema>;
