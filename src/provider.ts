import { messagesFor } from './prompt.ts';

export interface Generation {
  output: string;
  model: string;
  latencyMs: number | null;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface Provider {
  name: 'replay' | 'deepseek' | 'ollama';
  model: string;
  generate(source: string, id: string): Promise<Generation>;
}

export class ProviderError extends Error {
  code: 'HTTP_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'INCOMPLETE_OUTPUT';
  constructor(code: ProviderError['code']) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const tokenCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function createProvider(config: {
  name: 'deepseek' | 'ollama';
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Provider {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$/.test(config.model))
    throw new Error('Invalid model name.');
  if (config.name === 'deepseek' && !config.apiKey?.trim())
    throw new Error('Set DEEPSEEK_API_KEY in your environment.');
  const timeoutMs = config.timeoutMs ?? 45_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new Error('Invalid timeout.');
  const request = config.fetchImpl ?? fetch;

  return {
    name: config.name,
    model: config.model,
    async generate(source) {
      const started = performance.now();
      const isCloud = config.name === 'deepseek';
      // Fixed destinations prevent accidentally forwarding cloud credentials elsewhere.
      const url = isCloud
        ? 'https://api.deepseek.com/chat/completions'
        : 'http://127.0.0.1:11434/api/chat';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (isCloud) headers.Authorization = `Bearer ${config.apiKey!}`;
      const body = isCloud
        ? {
            model: config.model,
            messages: messagesFor(source),
            stream: false,
            temperature: 0,
            max_tokens: 512,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' },
          }
        : {
            model: config.model,
            messages: messagesFor(source),
            stream: false,
            format: 'json',
            options: { temperature: 0, num_predict: 512 },
          };
      try {
        const response = await request(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderError('HTTP_ERROR');
        }
        // Bound response memory even when Content-Length is absent or misleading.
        const reader = response.body?.getReader();
        if (!reader) throw new ProviderError('INVALID_RESPONSE');
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            length += next.value.byteLength;
            if (length > 128_000) {
              await reader.cancel();
              throw new ProviderError('INVALID_RESPONSE');
            }
            chunks.push(next.value);
          }
        } finally {
          reader.releaseLock();
        }
        let data: unknown;
        try {
          data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new ProviderError('INVALID_RESPONSE');
        }
        if (!record(data) || typeof data.model !== 'string' || !data.model.trim())
          throw new ProviderError('INVALID_RESPONSE');
        let output: unknown;
        let inputTokens: unknown;
        let outputTokens: unknown;
        if (isCloud) {
          const choice: unknown = Array.isArray(data.choices) ? data.choices[0] : null;
          if (!record(choice)) throw new ProviderError('INVALID_RESPONSE');
          if (choice.finish_reason !== 'stop') throw new ProviderError('INCOMPLETE_OUTPUT');
          output = record(choice.message) ? choice.message.content : null;
          inputTokens = record(data.usage) ? data.usage.prompt_tokens : null;
          outputTokens = record(data.usage) ? data.usage.completion_tokens : null;
        } else {
          if (data.done !== true || data.done_reason !== 'stop')
            throw new ProviderError('INCOMPLETE_OUTPUT');
          output = record(data.message) ? data.message.content : null;
          inputTokens = data.prompt_eval_count;
          outputTokens = data.eval_count;
        }
        if (typeof output !== 'string' || !output.trim() || output.length > 20_000)
          throw new ProviderError('INVALID_RESPONSE');
        return {
          output,
          model: data.model,
          latencyMs: Math.round(performance.now() - started),
          usage:
            tokenCount(inputTokens) && tokenCount(outputTokens)
              ? { inputTokens, outputTokens }
              : null,
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        )
          throw new ProviderError('TIMEOUT');
        // Do not echo provider bodies, source text, headers or low-level network errors.
        throw new ProviderError('NETWORK_ERROR');
      }
    },
  };
}
