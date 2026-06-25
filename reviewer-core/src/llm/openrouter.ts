import OpenAI from 'openai';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { toJsonSchema, parseWithRepair } from './structured.js';

/**
 * The single OpenAI-compatible structured provider, owned by the engine because
 * BOTH consumers need it: the CI runner (the GitHub Action runs reviewer-core
 * directly) and the studio server's openrouter path. Centralizing it here means
 * session grouping, the no-choices guard, request timeouts, and the
 * parse-with-repair loop live in ONE place instead of being duplicated.
 *
 * OpenRouter is OpenAI-compatible, so we drive it with the OpenAI SDK pointed at
 * its baseURL. Only completeStructured is needed by reviewPullRequest; the rest
 * are stubs. Cost attribution is INJECTED (`estimateCost`) so the engine stays
 * free of a pricing table — the server passes its own, the runner passes none.
 */

const NOT_SUPPORTED = 'OpenRouterProvider only implements completeStructured';

export interface OpenRouterProviderOptions {
  /** OpenAI-compatible base URL (default: OpenRouter). */
  baseURL?: string;
  /** Provider id for traces/gating (default 'openrouter'). */
  id?: 'openai' | 'openrouter';
  /** Per-request timeout (ms) — the SDK retries on timeout/5xx/429 with backoff. */
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected cost estimator; returns USD or null when the model is unknown. */
  estimateCost?: (model: string, tokensIn: number, tokensOut: number) => number | null;
}

export class OpenRouterProvider implements LLMProvider {
  readonly id: 'openai' | 'openrouter';
  private client: OpenAI;
  private baseURL: string;
  private apiKey: string;
  private estimateCost?: OpenRouterProviderOptions['estimateCost'];

  constructor(apiKey: string, opts: OpenRouterProviderOptions = {}) {
    this.id = opts.id ?? 'openrouter';
    this.apiKey = apiKey;
    this.baseURL = opts.baseURL ?? 'https://openrouter.ai/api/v1';
    this.estimateCost = opts.estimateCost;
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      timeout: opts.timeoutMs ?? 90_000,
      // Disable SDK-level retries — completeWithConnectionRetry owns all
      // connection-error retries with proper backoff (3s, 9s).
      maxRetries: opts.maxRetries ?? 0,
    });
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    const maxRetries = req.maxRetries ?? 2;
    const messages = [...req.messages];
    let tokensIn = 0;
    let tokensOut = 0;
    let costFromApi: number | null = null;
    let lastRaw = '';

    // For json_object mode the model needs the schema in the prompt.
    if (this.id !== 'openai') {
      const schemaHint = `\n\nRespond with ONLY a JSON object matching this JSON Schema (no prose, no fences):\n${JSON.stringify(jsonSchema.schema, null, 2)}`;
      const last = messages[messages.length - 1];
      if (last?.role === 'user') {
        messages[messages.length - 1] = { ...last, content: last.content + schemaHint };
      }
    }

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      // Stream the response so tokens flow continuously — without streaming, OpenRouter
      // buffers the full response and a connection-level timeout fires before long
      // generations finish, producing "Premature close" errors.
      const completion = await this.completeWithConnectionRetry(async () => {
        const stream = await this.client.chat.completions.create({
          model: req.model,
          messages,
          temperature: req.temperature ?? 0,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          // json_schema strict mode is only supported by OpenAI's own models;
          // OpenRouter routes to many providers, most of which don't implement it
          // and drop the connection after sending HTTP 200. Use json_object for
          // OpenRouter — all major models support it, and parseWithRepair validates
          // against the Zod schema with a repair loop.
          response_format: this.id === 'openai'
            ? ({ type: 'json_schema', json_schema: { name: req.schemaName, schema: jsonSchema.schema, strict: true } } as const)
            : ({ type: 'json_object' } as const),
          // OpenRouter session grouping — extra body field (spread is exempt from
          // excess-property checks). Only sent when talking to OpenRouter.
          ...(this.id === 'openrouter' && req.sessionId ? { session_id: req.sessionId } : {}),
          // OpenRouter usage accounting — ask it to return the REAL generation
          // cost (USD) in `usage.cost`, instead of estimating from a price book.
          ...(this.id === 'openrouter' ? { usage: { include: true } } : {}),
          stream: true,
          stream_options: { include_usage: true },
        });

        let content = '';
        let usage: OpenAI.CompletionUsage | null = null;
        let errorBody: { message?: string } | null = null;

        for await (const chunk of stream) {
          content += chunk.choices[0]?.delta?.content ?? '';
          if (chunk.usage) usage = chunk.usage;
          // OpenRouter can embed an error object in a 200 streaming response
          const err = (chunk as unknown as { error?: { message?: string } }).error;
          if (err) errorBody = err;
        }

        return { content, usage, errorBody };
      });

      // OpenRouter can return HTTP 200 with no content (upstream provider error)
      if (completion.errorBody || !completion.content) {
        const msg = completion.errorBody?.message ?? 'empty response';
        throw new Error(`OpenRouter returned no content for ${req.schemaName}: ${msg}`);
      }
      lastRaw = completion.content;
      tokensIn += completion.usage?.prompt_tokens ?? 0;
      tokensOut += completion.usage?.completion_tokens ?? 0;
      // `usage.cost` is an OpenRouter extension (USD), absent from the OpenAI SDK type.
      const apiCost = (completion.usage as { cost?: number } | null | undefined)?.cost;
      if (typeof apiCost === 'number') costFromApi = (costFromApi ?? 0) + apiCost;

      const parsed = parseWithRepair(req.schema, lastRaw);
      if (parsed.ok) {
        return {
          data: parsed.data,
          model: req.model,
          tokensIn,
          tokensOut,
          costUsd: costFromApi ?? this.estimateCost?.(req.model, tokensIn, tokensOut) ?? null,
          raw: lastRaw,
          attempts: attempt,
        };
      }
      messages.push({ role: 'assistant', content: lastRaw });
      messages.push({ role: 'user', content: parsed.repromptMessage });
    }
    throw new Error(`OpenRouter structured output failed schema validation for ${req.schemaName}`);
  }

  /**
   * List models with pricing from the OpenRouter `/models` endpoint (the OpenAI
   * SDK's models.list strips the `pricing` field, so we fetch raw). Prices are
   * converted from per-token to USD per 1M tokens; cheapest output first.
   */
  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseURL}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    const models: ModelInfo[] = (json.data ?? []).map((m) => {
      const prompt = Number(m.pricing?.prompt);
      const completion = Number(m.pricing?.completion);
      // OpenRouter uses -1 as a sentinel for variable-priced router pseudo-models
      // (openrouter/auto etc.) — treat negatives as "unknown" so they don't show
      // as $-1000000 and don't sort to the top of the cheapest list.
      const pricing =
        Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
          ? { promptPerM: prompt * 1_000_000, completionPerM: completion * 1_000_000 }
          : null;
      return {
        id: m.id,
        provider: 'openrouter' as const,
        label: m.name ?? null,
        pricing,
        contextLength: m.context_length ?? null,
      };
    });
    return models.sort(
      (a, b) => (a.pricing?.completionPerM ?? Infinity) - (b.pricing?.completionPerM ?? Infinity),
    );
  }
  /** Retry the LLM call on TCP-level connection drops (Premature close / ECONNRESET).
   *  Schema-parse retries are handled by the outer loop in completeStructured. */
  private async completeWithConnectionRetry<T>(fn: () => Promise<T>): Promise<T> {
    // 3 attempts: waits 3s then 9s between retries — long enough for OpenRouter to
    // recover from brief service hiccups (deepseek-v4-flash drops connections under load).
    const DELAYS = [3_000, 9_000];
    for (let i = 0; i <= DELAYS.length; i++) {
      try {
        return await fn();
      } catch (err) {
        const isConn =
          (err as { name?: string })?.name === 'APIConnectionError' ||
          (err as { code?: string })?.code === 'ECONNRESET' ||
          String((err as { message?: string })?.message).includes('Premature close') ||
          String((err as { message?: string })?.message).includes('fetch failed');
        if (!isConn || i === DELAYS.length) throw err;
        await new Promise((r) => setTimeout(r, DELAYS[i]));
      }
    }
    throw new Error('unreachable');
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error(NOT_SUPPORTED);
  }
  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(NOT_SUPPORTED);
  }
}
