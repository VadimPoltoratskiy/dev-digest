import '@anthropic-ai/sdk/shims/web'; // force SDK to use native fetch (node-fetch v2 breaks on Node 22)
import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  ChatMessage,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import { toJsonSchema, parseWithRepair } from '../../platform/structured.js';
import { estimateCost } from './pricing.js';
import { ExternalServiceError } from '../../platform/errors.js';

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * zodResponseFormat (OpenAI SDK) generates schemas with $defs + $ref.
 * Anthropic does not resolve $ref in tool input_schema, so the model sees
 * an empty schema and returns {}. This function inlines all $refs before
 * the schema is sent to Anthropic.
 */
function resolveRefs(schema: Record<string, unknown>): Record<string, unknown> {
  const defs = schema.$defs as Record<string, unknown> | undefined;

  function resolve(node: unknown): unknown {
    if (typeof node !== 'object' || node === null) return node;
    if (Array.isArray(node)) return node.map(resolve);
    const obj = node as Record<string, unknown>;
    if ('$ref' in obj && typeof obj.$ref === 'string' && obj.$ref.startsWith('#/$defs/')) {
      const defName = obj.$ref.slice('#/$defs/'.length);
      return resolve((defs?.[defName] ?? {}) as Record<string, unknown>);
    }
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([k]) => k !== '$defs' && k !== '$schema')
        .map(([k, v]) => [k, resolve(v)]),
    );
  }

  return resolve(schema) as Record<string, unknown>;
}

/** Anthropic has no embeddings API; embeddings come from the OpenAI Embedder. */
function splitSystem(messages: ChatMessage[]): {
  system: string;
  rest: Anthropic.MessageParam[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  return { system, rest };
}

/**
 * Anthropic LLMProvider.
 * - listModels: dynamic via GET /models.
 * - completeStructured: FORCED tool-use (single tool, input_schema = our JSON
 *   schema, tool_choice forces it), parse tool_use.input, Zod validate + reprompt.
 * - embed: NOT supported (throws) — use the OpenAI Embedder for vectors.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async listModels(): Promise<ModelInfo[]> {
    return withRetry(async () => {
      // SDK 0.33 exposes models.list()
      const res = await this.client.models.list();
      return res.data.map((m) => ({
        id: m.id,
        provider: 'anthropic' as const,
        label: m.display_name,
      }));
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return withRetry(() => withTimeout(this.doComplete(req), req.timeoutMs ?? DEFAULT_TIMEOUT));
  }

  private toServiceError(err: unknown): never {
    if (err instanceof Anthropic.APIError) {
      const body = err.error as { error?: { message?: string } } | undefined;
      const msg = body?.error?.message ?? err.message;
      throw new ExternalServiceError(msg, { status: err.status });
    }
    throw err;
  }

  private async doComplete(req: CompletionRequest): Promise<CompletionResult> {
    const { system, rest } = splitSystem(req.messages);
    let res: Awaited<ReturnType<typeof this.client.messages.create>>;
    try {
      res = await this.client.messages.create({
        model: req.model,
        system: system || undefined,
        messages: rest,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: req.temperature ?? 0.2,
      });
    } catch (err) {
      this.toServiceError(err);
    }
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const tokensIn = res.usage.input_tokens;
    const tokensOut = res.usage.output_tokens;
    return {
      text,
      model: req.model,
      tokensIn,
      tokensOut,
      costUsd: estimateCost(req.model, tokensIn, tokensOut),
    };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    const resolvedSchema = resolveRefs(jsonSchema.schema);
    const toolName = req.schemaName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const maxRetries = req.maxRetries ?? 2;
    const { system, rest } = splitSystem(req.messages);
    const messages: Anthropic.MessageParam[] = [...rest];
    let tokensIn = 0;
    let tokensOut = 0;
    let lastRaw = '';
    let lastParseError = '';

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      let res: Awaited<ReturnType<typeof this.client.messages.create>>;
      try {
        res = await withRetry(() =>
          withTimeout(
            this.client.messages.create({
              model: req.model,
              system: system || undefined,
              messages,
              max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
              temperature: req.temperature ?? 0,
              tools: [
                {
                  name: toolName,
                  description: `Return the result as ${req.schemaName}.`,
                  input_schema: resolvedSchema as Anthropic.Tool.InputSchema,
                },
              ],
              tool_choice: { type: 'tool', name: toolName },
            }),
            req.timeoutMs ?? DEFAULT_TIMEOUT,
          ),
        );
      } catch (err) {
        this.toServiceError(err);
      }
      tokensIn += res.usage.input_tokens;
      tokensOut += res.usage.output_tokens;

      const toolUse = res.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      if (!toolUse) {
        console.error('[completeStructured] attempt', attempt, '— no tool_use block. stop_reason:', (res as { stop_reason?: string }).stop_reason);
      }
      lastRaw = toolUse ? JSON.stringify(toolUse.input) : '';

      const parsed = parseWithRepair(req.schema, lastRaw);
      if (parsed.ok) {
        return {
          data: parsed.data,
          model: req.model,
          tokensIn,
          tokensOut,
          costUsd: estimateCost(req.model, tokensIn, tokensOut),
          raw: lastRaw,
          attempts: attempt,
        };
      }
      lastParseError = parsed.error;
      messages.push({ role: 'assistant', content: res.content });
      messages.push({
        role: 'user',
        content: toolUse
          ? [{ type: 'tool_result' as const, tool_use_id: toolUse.id, content: parsed.repromptMessage, is_error: true }]
          : parsed.repromptMessage,
      });
    }

    throw new ExternalServiceError('Anthropic structured output failed schema validation', {
      raw: lastRaw,
      validationError: lastParseError,
    });
  }

  async embed(): Promise<number[][]> {
    throw new ExternalServiceError(
      'Anthropic does not provide embeddings; use the OpenAI Embedder.',
    );
  }
}
