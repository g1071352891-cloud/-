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
        return callCustom(settings, messages, spec);
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
            // openai + reverse_proxy 会把本扩展自己的 Key 交给酒馆后端转发，避开浏览器 CORS。
            const rawRequest = {
                stream: false,
                messages,
                model,
                chat_completion_source: 'openai',
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

export function normalizeBaseUrl(url) {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    if (!trimmed) return 'https://api.openai.com/v1';
    if (/\/v1$/i.test(trimmed) || /\/v1beta$/i.test(trimmed)) return trimmed;
    if (/\/chat\/completions$/i.test(trimmed)) return trimmed.replace(/\/chat\/completions$/i, '');
    return `${trimmed}/v1`;
}

function joinUrl(base, path) {
    if (/\/chat\/completions$/i.test(base)) return base;
    if (/\/models$/i.test(base) && path === 'models') return base;
    return `${base.replace(/\/+$/, '')}/${path}`;
}

function extractModelIds(payload) {
    if (!payload) return [];
    const raw = Array.isArray(payload)
        ? payload
        : (payload.data || payload.models || payload.model_list || []);
    if (!Array.isArray(raw)) return [];
    const ids = raw.map((item) => {
        if (typeof item === 'string') return item.trim();
        return String(item?.id || item?.name || item?.model || '').trim();
    }).filter(Boolean);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b, 'zh'));
}

async function fetchModelsDirect(baseUrl, apiKey) {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(joinUrl(baseUrl, 'models'), { method: 'GET', headers });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${text.slice(0, 160)}`);
    }
    return extractModelIds(await response.json());
}

async function fetchModelsViaSt(baseUrl, apiKey) {
    const ctx = SillyTavern.getContext();
    const headers = typeof ctx.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };
    const response = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            chat_completion_source: 'openai',
            reverse_proxy: baseUrl,
            proxy_password: apiKey || '',
        }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`酒馆代理 ${response.status} ${text.slice(0, 160)}`);
    }
    return extractModelIds(await response.json());
}

/**
 * @param {ReturnType<typeof getSettings>} [settings]
 * @returns {Promise<{ models: string[], via: string, ms: number }>}
 */
export async function listDirectorModels(settings = getSettings()) {
    const baseUrl = normalizeBaseUrl(settings.apiBaseUrl);
    if (!String(settings.apiBaseUrl || '').trim()) {
        throw new Error('请先填写 Base URL');
    }
    const started = Date.now();
    const errors = [];
    try {
        const models = await fetchModelsDirect(baseUrl, settings.apiKey);
        return { models, via: 'direct', ms: Date.now() - started };
    } catch (err) {
        errors.push(`直连：${err.message || err}`);
    }
    try {
        const models = await fetchModelsViaSt(baseUrl, settings.apiKey);
        return { models, via: 'proxy', ms: Date.now() - started };
    } catch (err) {
        errors.push(`代理：${err.message || err}`);
        throw new Error(errors.join('；'));
    }
}

async function pingChat(settings) {
    const started = Date.now();
    const spec = {
        system: 'You are a connection probe. Reply with the single word OK.',
        user: 'ping',
        maxTokens: 8,
        temperature: 0,
    };
    if (settings.apiMode === API_MODE.CUSTOM) {
        await callCustom(settings, [
            { role: 'system', content: spec.system },
            { role: 'user', content: spec.user },
        ], spec);
    } else {
        await callMain([
            { role: 'system', content: spec.system },
            { role: 'user', content: spec.user },
        ], spec);
    }
    return Date.now() - started;
}

/**
 * Lightweight connectivity check. Prefers GET /models, then a tiny chat completion.
 * @param {ReturnType<typeof getSettings>} [settings]
 */
export async function testDirectorConnection(settings = getSettings()) {
    if (settings.apiMode !== API_MODE.CUSTOM) {
        const ms = await pingChat(settings);
        const model = SillyTavern.getContext().getChatCompletionModel?.() || '酒馆主模型';
        return { ok: true, ms, message: `酒馆主模型可用（${model}），探测 ${ms}ms` };
    }
    if (!String(settings.apiBaseUrl || '').trim()) {
        return { ok: false, message: '请先填写 Base URL' };
    }
    try {
        const listed = await listDirectorModels(settings);
        const via = listed.via === 'proxy' ? '经酒馆代理' : '直连';
        return {
            ok: true,
            ms: listed.ms,
            models: listed.models,
            message: `连接成功（${via}），可用模型 ${listed.models.length} 个，${listed.ms}ms`,
        };
    } catch (listErr) {
        try {
            const ms = await pingChat(settings);
            return {
                ok: true,
                ms,
                models: [],
                message: `对话接口可用（${ms}ms）。/models 拉取失败：${listErr.message || listErr}`,
            };
        } catch (chatErr) {
            return { ok: false, message: String(chatErr.message || chatErr) };
        }
    }
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
