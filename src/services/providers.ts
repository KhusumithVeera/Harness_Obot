import { ChatMessage, ModelInfo, ProviderId, SourceCitation } from '../types';
import { providerFetch } from './network';

export interface StreamYield {
  text?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  sources?: SourceCitation[];
}

export interface StreamChatOptions {
  key: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  useGeminiSearch?: boolean;
}

export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  listModels: (key: string) => Promise<ModelInfo[]>;
  streamChat: (options: StreamChatOptions) => AsyncGenerator<StreamYield, void, unknown>;
  supportsImages: (model: string) => boolean;
}

// Map HTTP errors to friendly messages
async function handleHttpError(res: Response, providerName: string, model: string): Promise<never> {
  let errText = '';
  try {
    const raw = await res.text();
    try {
      const json = JSON.parse(raw);
      errText =
        json.error?.message ||
        json.message ||
        (Array.isArray(json.error) ? json.error[0]?.message : '') ||
        raw;
    } catch {
      errText = raw;
    }
  } catch {}

  const isImageError =
    res.status === 400 &&
    (errText.toLowerCase().includes('image') ||
      errText.toLowerCase().includes('vision') ||
      errText.toLowerCase().includes('multimodal'));

  if (isImageError) {
    const err: any = new Error(errText || "Model doesn't support images.");
    err.isImageRejection = true;
    throw err;
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Invalid or unauthorized API key for ${providerName}. Check it in Settings.`);
  }
  if (res.status === 404) {
    throw new Error(`Model '${model}' isn't available for your key. Pick another.`);
  }
  if (res.status === 429) {
    throw new Error(
      `Rate limit or quota reached for ${providerName}. Wait a moment or check your billing/quota.`
    );
  }
  if (res.status === 413 || errText.toLowerCase().includes('too long') || errText.toLowerCase().includes('context length')) {
    throw new Error("That's too much text for this model. Use Retrieval mode or a shorter input.");
  }
  if (res.status >= 500) {
    throw new Error(`${providerName} is having trouble. Try again in a moment.`);
  }

  throw new Error(errText ? `${errText}` : `Request failed with status ${res.status}`);
}

// SSE stream reader utility
async function* readSseLines(response: Response, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body received from provider.');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) yield trimmed;
      }
    }

    if (buffer.trim()) {
      yield buffer.trim();
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

// -------------------------------------------------------------
// 1. OpenAI Adapter
// -------------------------------------------------------------
export const openAiAdapter: ProviderAdapter = {
  id: 'openai',
  name: 'OpenAI',

  supportsImages(model: string) {
    const m = model.toLowerCase();
    if (m.includes('gpt-3.5') || m.includes('instruct')) return false;
    return true;
  },

  async listModels(key: string): Promise<ModelInfo[]> {
    const res = await providerFetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      providerName: 'OpenAI',
    });

    if (!res.ok) {
      await handleHttpError(res, 'OpenAI', '');
    }

    const data = await res.json();
    const excludePatterns = [
      'embedding', 'whisper', 'tts', 'dall-e', 'image', 'audio',
      'realtime', 'transcribe', 'moderation', 'search-preview', 'instruct',
    ];

    const models: ModelInfo[] = [];
    for (const item of data.data || []) {
      const id = String(item.id || '');
      const startsValid =
        id.startsWith('gpt-') ||
        id.startsWith('o1') ||
        id.startsWith('o3') ||
        id.startsWith('o4') ||
        id.startsWith('chatgpt-');

      if (!startsValid) continue;

      const shouldExclude = excludePatterns.some((pattern) => id.includes(pattern));
      if (shouldExclude) continue;

      models.push({
        id,
        name: id,
        provider: 'openai',
        supportsImages: openAiAdapter.supportsImages(id),
      });
    }

    // Sort newest / alphabetical descending
    models.sort((a, b) => b.id.localeCompare(a.id));
    return models;
  },

  async *streamChat({ key, model, system, messages, signal }): AsyncGenerator<StreamYield, void, unknown> {
    const formattedMessages: any[] = [];
    if (system) {
      formattedMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      if (msg.images && msg.images.length > 0) {
        const contentParts: any[] = [{ type: 'text', text: msg.content || '' }];
        for (const img of msg.images) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${img.mime};base64,${img.base64}` },
          });
        }
        formattedMessages.push({ role: msg.role, content: contentParts });
      } else {
        formattedMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const res = await providerFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
      providerName: 'OpenAI',
    });

    if (!res.ok) {
      await handleHttpError(res, 'OpenAI', model);
    }

    for await (const line of readSseLines(res, signal)) {
      if (line.startsWith('data: ')) {
        const payload = line.substring(6).trim();
        if (payload === '[DONE]') break;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          const usage = parsed.usage;

          if (delta) {
            yield { text: delta };
          }
          if (usage) {
            yield {
              usage: {
                inputTokens: usage.prompt_tokens,
                outputTokens: usage.completion_tokens,
              },
            };
          }
        } catch {}
      }
    }
  },
};

// -------------------------------------------------------------
// 2. Anthropic Adapter
// -------------------------------------------------------------
export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  name: 'Anthropic',

  supportsImages(model: string) {
    const m = model.toLowerCase();
    return m.includes('claude-3') || m.includes('claude-3-5');
  },

  async listModels(key: string): Promise<ModelInfo[]> {
    const res = await providerFetch('https://api.anthropic.com/v1/models?limit=100', {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      providerName: 'Anthropic',
    });

    if (!res.ok) {
      await handleHttpError(res, 'Anthropic', '');
    }

    const data = await res.json();
    const models: ModelInfo[] = [];
    for (const item of data.data || []) {
      models.push({
        id: item.id,
        name: item.display_name || item.id,
        provider: 'anthropic',
        supportsImages: anthropicAdapter.supportsImages(item.id),
      });
    }

    models.sort((a, b) => b.id.localeCompare(a.id));
    return models;
  },

  async *streamChat({ key, model, system, messages, signal }): AsyncGenerator<StreamYield, void, unknown> {
    // Anthropic requires:
    // 1. Alternating user/assistant roles
    // 2. Must start with a user message (drop leading assistant messages)
    // 3. Merge consecutive same-role messages

    const rawFiltered = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    // Drop leading assistant messages
    while (rawFiltered.length > 0 && rawFiltered[0].role !== 'user') {
      rawFiltered.shift();
    }

    const formattedMessages: any[] = [];
    for (const msg of rawFiltered) {
      let contentArray: any[] = [];
      if (msg.images && msg.images.length > 0) {
        for (const img of msg.images) {
          contentArray.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mime,
              data: img.base64,
            },
          });
        }
      }
      if (msg.content) {
        contentArray.push({ type: 'text', text: msg.content });
      }

      if (contentArray.length === 0) {
        contentArray = [{ type: 'text', text: ' ' }];
      }

      const last = formattedMessages[formattedMessages.length - 1];
      if (last && last.role === msg.role) {
        // Merge consecutive same role
        last.content = [...last.content, ...contentArray];
      } else {
        formattedMessages.push({
          role: msg.role,
          content: contentArray,
        });
      }
    }

    if (formattedMessages.length === 0) {
      formattedMessages.push({ role: 'user', content: [{ type: 'text', text: 'Hello' }] });
    }

    const res = await providerFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        stream: true,
        system: system || undefined,
        messages: formattedMessages,
      }),
      signal,
      providerName: 'Anthropic',
    });

    if (!res.ok) {
      await handleHttpError(res, 'Anthropic', model);
    }

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const line of readSseLines(res, signal)) {
      if (line.startsWith('data: ')) {
        const payload = line.substring(6).trim();
        try {
          const parsed = JSON.parse(payload);

          if (parsed.type === 'error') {
            throw new Error(parsed.error?.message || 'Anthropic stream error');
          }

          if (parsed.type === 'message_start' && parsed.message?.usage) {
            inputTokens = parsed.message.usage.input_tokens || 0;
            yield { usage: { inputTokens, outputTokens } };
          }

          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            yield { text: parsed.delta.text || '' };
          }

          if (parsed.type === 'message_delta' && parsed.usage) {
            outputTokens = parsed.usage.output_tokens || 0;
            yield { usage: { inputTokens, outputTokens } };
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Anthropic stream error')) throw e;
        }
      }
    }
  },
};

// -------------------------------------------------------------
// 3. Google Gemini Adapter
// -------------------------------------------------------------
export const googleAdapter: ProviderAdapter = {
  id: 'google',
  name: 'Google Gemini',

  supportsImages(_model: string) {
    return true; // Gemini 1.5, 2.0, 2.5 are multimodal
  },

  async listModels(key: string): Promise<ModelInfo[]> {
    const res = await providerFetch(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      {
        method: 'GET',
        headers: { 'x-goog-api-key': key },
        providerName: 'Google Gemini',
      }
    );

    if (!res.ok) {
      await handleHttpError(res, 'Google Gemini', '');
    }

    const data = await res.json();
    const models: ModelInfo[] = [];

    for (const item of data.models || []) {
      const methods = item.supportedGenerationMethods || [];
      if (!methods.includes('generateContent')) continue;

      let id = item.name || '';
      if (id.startsWith('models/')) {
        id = id.substring(7);
      }

      // Filter out non-chat embedding or experimental specialized models
      if (id.includes('embedding') || id.includes('aqa') || id.includes('imagen')) continue;

      models.push({
        id,
        name: item.displayName || id,
        provider: 'google',
        supportsImages: true,
      });
    }

    models.sort((a, b) => b.id.localeCompare(a.id));
    return models;
  },

  async *streamChat({ key, model, system, messages, signal, useGeminiSearch }): AsyncGenerator<StreamYield, void, unknown> {
    const cleanModel = model.startsWith('models/') ? model.substring(7) : model;

    const contents: any[] = [];
    for (const msg of messages) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];

      if (msg.images && msg.images.length > 0) {
        for (const img of msg.images) {
          parts.push({
            inlineData: {
              mimeType: img.mime,
              data: img.base64,
            },
          });
        }
      }

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (parts.length === 0) {
        parts.push({ text: ' ' });
      }

      contents.push({ role, parts });
    }

    const bodyPayload: any = { contents };
    if (system) {
      bodyPayload.systemInstruction = {
        parts: [{ text: system }],
      };
    }

    if (useGeminiSearch) {
      bodyPayload.tools = [{ google_search: {} }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:streamGenerateContent?alt=sse`;

    let res = await providerFetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyPayload),
      signal,
      providerName: 'Google Gemini',
    });

    // If Google search tool caused an error (e.g. 400 or 403 on tools), fall back once without tool
    if (!res.ok && useGeminiSearch) {
      delete bodyPayload.tools;
      res = await providerFetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
        signal,
        providerName: 'Google Gemini',
      });
    }

    if (!res.ok) {
      await handleHttpError(res, 'Google Gemini', cleanModel);
    }

    for await (const line of readSseLines(res, signal)) {
      if (line.startsWith('data: ')) {
        const payload = line.substring(6).trim();
        try {
          const parsed = JSON.parse(payload);

          // Safety / block checks
          if (
            parsed.promptFeedback?.blockReason ||
            parsed.candidates?.[0]?.finishReason === 'SAFETY'
          ) {
            yield { text: '\n\n*(Gemini blocked this response for safety reasons.)*' };
            return;
          }

          const candidate = parsed.candidates?.[0];
          if (candidate?.content?.parts) {
            let combinedPartText = '';
            for (const part of candidate.content.parts) {
              if (part.text) {
                combinedPartText += part.text;
              }
            }
            if (combinedPartText) {
              yield { text: combinedPartText };
            }
          }

          // Grounding search chunks
          if (candidate?.groundingMetadata?.groundingChunks) {
            const sources: SourceCitation[] = [];
            for (const chunk of candidate.groundingMetadata.groundingChunks) {
              if (chunk.web?.uri) {
                sources.push({
                  type: 'web',
                  title: chunk.web.title || chunk.web.uri,
                  url: chunk.web.uri,
                  snippet: chunk.web.title || '',
                });
              }
            }
            if (sources.length > 0) {
              yield { sources };
            }
          }

          // Usage metadata
          if (parsed.usageMetadata) {
            yield {
              usage: {
                inputTokens: parsed.usageMetadata.promptTokenCount,
                outputTokens: parsed.usageMetadata.candidatesTokenCount,
              },
            };
          }
        } catch {}
      }
    }
  },
};

// -------------------------------------------------------------
// 4. xAI Grok Adapter
// -------------------------------------------------------------
export const xaiAdapter: ProviderAdapter = {
  id: 'xai',
  name: 'xAI Grok',

  supportsImages(model: string) {
    const m = model.toLowerCase();
    return m.includes('vision');
  },

  async listModels(key: string): Promise<ModelInfo[]> {
    const res = await providerFetch('https://api.x.ai/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      providerName: 'xAI Grok',
    });

    if (!res.ok) {
      await handleHttpError(res, 'xAI Grok', '');
    }

    const data = await res.json();
    const models: ModelInfo[] = [];

    for (const item of data.data || []) {
      const id = String(item.id || '');
      if (id.includes('grok') && !id.includes('image') && !id.includes('imagine')) {
        models.push({
          id,
          name: id,
          provider: 'xai',
          supportsImages: xaiAdapter.supportsImages(id),
        });
      }
    }

    models.sort((a, b) => b.id.localeCompare(a.id));
    return models;
  },

  async *streamChat({ key, model, system, messages, signal }): AsyncGenerator<StreamYield, void, unknown> {
    const formattedMessages: any[] = [];
    if (system) {
      formattedMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      if (msg.images && msg.images.length > 0) {
        const contentParts: any[] = [{ type: 'text', text: msg.content || '' }];
        for (const img of msg.images) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:${img.mime};base64,${img.base64}` },
          });
        }
        formattedMessages.push({ role: msg.role, content: contentParts });
      } else {
        formattedMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const res = await providerFetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: formattedMessages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
      providerName: 'xAI Grok',
    });

    if (!res.ok) {
      await handleHttpError(res, 'xAI Grok', model);
    }

    for await (const line of readSseLines(res, signal)) {
      if (line.startsWith('data: ')) {
        const payload = line.substring(6).trim();
        if (payload === '[DONE]') break;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content;
          const usage = parsed.usage;

          if (delta) {
            yield { text: delta };
          }
          if (usage) {
            yield {
              usage: {
                inputTokens: usage.prompt_tokens,
                outputTokens: usage.completion_tokens,
              },
            };
          }
        } catch {}
      }
    }
  },
};

// Providers registry
export const PROVIDERS: Record<ProviderId, ProviderAdapter> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
  google: googleAdapter,
  xai: xaiAdapter,
};

export function getProvider(id: ProviderId): ProviderAdapter {
  return PROVIDERS[id] || openAiAdapter;
}

export function detectProviderFromModel(modelId: string): ProviderId {
  const m = modelId.toLowerCase();
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gemini')) return 'google';
  if (m.startsWith('grok')) return 'xai';
  return 'openai';
}
