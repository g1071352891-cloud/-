import { API_MODE, LOG_PREFIX } from './constants.js';
import { getSettings } from './settings.js';

const DEFAULT_MAX_TOKENS = 4096;

/**
 * Call either the tavern main model or an independent OpenAI-compatible endpoint.
 * Always returns a string (or parsed object if the backend already parsed JSON).
 * @param {{
 *  system: string,
 *  user: string,
 *  jsonSchema?: object|null,
 *  maxTokens?: number,
 *  temperature?: number,
 * }} spec
 * @returns {Promise<string|object>}
 */
export async function callDirector(spec) {
    const settings = getSettings();
    const messages = [
        { role: 'system', content: spec.system },
        { role: 'user', content: spec.user },
    ];

    if (settings.apiMode === API_MODE.CUSTOM && (settings.apiBaseUrl || settings.apiModel)) {
        try {
            return await callCustom(settings, messages, spec);
        } catch (err) {
            console.warn(LOG_PREFIX, 'Custom director API failed, falling back to main model', err);
        }
    }

    return callMain(messages, spec);
}

async function callMain(messages, spec) {
    const ctx = SillyTavern.getContext();
    if (typeof ctx.generateRaw !== 'function') {
        throw new Error('SillyTavern generateRaw is unavailable');
    }

    const payload = {
        systemPrompt: spec.system,
        prompt: spec.user,
        maxTokens: spec.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: spec.temperature ?? 0.35,
    };
    if (spec.jsonSchema) {
        payload.jsonSchema = spec.jsonSchema;
    }

    try {
        const result = await ctx.generateRaw(payload);
        return unwrapGenerateResult(result);
    } catch (err) {
        if (!payload.jsonSchema) throw err;
        console.warn(LOG_PREFIX, 'generateRaw jsonSchema failed, retrying plain JSON prompt', err);
        delete payload.jsonSchema;
        const result = await ctx.generateRaw(payload);
        return unwrapGenerateResult(result);
    }
}

async function callCustom(settings, messages, spec) {
    const ctx = SillyTavern.getContext();
    const baseUrl = normalizeBaseUrl(settings.apiBaseUrl);
    const model = settings.apiModel || ctx.getChatCompletionModel?.() || 'gpt-4o-mini';

    if (ctx.ChatCompletionService?.sendRequest) {
        try {
            const rawRequest = {
                stream: false,
                messages,
                model,
                chat_completion_source: 'custom',
                max_tokens: spec.maxTokens || DEFAULT_MAX_TOKENS,
                temperature: spec.temperature ?? 0.35,
                custom_url: baseUrl,
                reverse_proxy: baseUrl,
                proxy_password: settings.apiKey || undefined,
                json_schema: spec.jsonSchema || undefined,
            };
            const request = ctx.ChatCompletionService.createRequestData
                ? ctx.ChatCompletionService.createRequestData(rawRequest)
                : rawRequest;
            const result = await ctx.ChatCompletionService.sendRequest(request, true);
            return unwrapGenerateResult(result);
        } catch (err) {
            console.warn(LOG_PREFIX, 'ChatCompletionService custom call failed, trying direct fetch', err);
        }
    }

    return directOpenAIFetch({
        baseUrl,
        apiKey: settings.apiKey,
        model,
        messages,
        maxTokens: spec.maxTokens || DEFAULT_MAX_TOKENS,
        temperature: spec.temperature ?? 0.35,
        forceJson: Boolean(spec.jsonSchema),
    });
}

async function directOpenAIFetch({ baseUrl, apiKey, model, messages, maxTokens, temperature, forceJson }) {
    const endpoint = joinUrl(baseUrl, 'chat/completions');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const body = {
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
    };
    if (forceJson) {
        body.response_format = { type: 'json_object' };
    }

    let response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok && forceJson) {
        delete body.response_format;
        response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Director API ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = await response.json();
    return json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || '';
}

function unwrapGenerateResult(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
        if (typeof result.content === 'string' || typeof result.content === 'object') return result.content;
        if (result.choices?.[0]?.message?.content) return result.choices[0].message.content;
    }
    return String(result);
}

function normalizeBaseUrl(url) {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    if (!trimmed) return 'https://api.openai.com/v1';
    if (/\/v1$/i.test(trimmed) || /\/v1beta$/i.test(trimmed)) return trimmed;
    if (/\/chat\/completions$/i.test(trimmed)) return trimmed.replace(/\/chat\/completions$/i, '');
    return `${trimmed}/v1`;
}

function joinUrl(base, path) {
    if (/\/chat\/completions$/i.test(base)) return base;
    return `${base.replace(/\/+$/, '')}/${path}`;
}

/**
 * Parse JSON even when the model wraps it in fences or prose.
 * @param {string|object} raw
 * @returns {object}
 */
export function parseJsonLoose(raw) {
    if (raw && typeof raw === 'object') return raw;
    const text = String(raw || '').trim();
    if (!text) throw new Error('Empty director response');

    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fence ? fence[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Director response was not JSON');
    }
    const sliced = candidate.slice(start, end + 1);
    try {
        return JSON.parse(sliced);
    } catch {
        const repaired = sliced
            .replace(/,\s*([}\]])/g, '$1')
            .replace(/[\u201c\u201d]/g, '"');
        return JSON.parse(repaired);
    }
}
