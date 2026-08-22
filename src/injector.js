import {
    EXTENSION_PROMPT_KEY,
    INJECTION_MARKER,
    LOG_PREFIX,
    PROMPT_POSITION_IN_CHAT,
    PROMPT_ROLE_SYSTEM,
} from './constants.js';
import { getSettings } from './settings.js';

/** @type {string} */
let currentInjection = '';

export function getCurrentInjection() {
    return currentInjection;
}

export function setDirectorInjection(text) {
    currentInjection = String(text || '').trim();
    const ctx = SillyTavern.getContext();
    const settings = getSettings();
    const value = settings.enabled && settings.injectEnabled ? currentInjection : '';
    try {
        ctx.setExtensionPrompt(
            EXTENSION_PROMPT_KEY,
            value,
            PROMPT_POSITION_IN_CHAT,
            0,
            false,
            PROMPT_ROLE_SYSTEM,
        );
    } catch (err) {
        console.warn(LOG_PREFIX, 'setExtensionPrompt failed', err);
    }
}

export function clearDirectorInjection() {
    currentInjection = '';
    const ctx = SillyTavern.getContext();
    try {
        ctx.setExtensionPrompt(EXTENSION_PROMPT_KEY, '', PROMPT_POSITION_IN_CHAT, 0, false, PROMPT_ROLE_SYSTEM);
    } catch {
        // ignore
    }
}

/**
 * Ensure the director block sits at Depth 0 as a trailing system message.
 * ST already inserts setExtensionPrompt content; this is a safety net for the
 * chat_completion_prompt_ready hook requested by the spec.
 * @param {{ chat?: Array<{role:string, content:string}>, dryRun?: boolean }} eventData
 */
export function injectIntoChatCompletion(eventData) {
    if (!eventData || eventData.dryRun) return;
    const settings = getSettings();
    if (!settings.enabled || !settings.injectEnabled || !currentInjection) return;
    const chat = eventData.chat;
    if (!Array.isArray(chat)) return;

    const already = chat.some((m) => String(m?.content || '').includes(INJECTION_MARKER));
    if (already) return;

    chat.push({
        role: 'system',
        content: currentInjection,
    });
}

export function bindPromptHooks() {
    const ctx = SillyTavern.getContext();
    const { eventSource, event_types: types } = ctx;
    if (!eventSource?.on) return;

    const ccReady = types?.CHAT_COMPLETION_PROMPT_READY || 'chat_completion_prompt_ready';
    eventSource.on(ccReady, (eventData) => {
        try {
            injectIntoChatCompletion(eventData);
        } catch (err) {
            console.warn(LOG_PREFIX, 'chat_completion_prompt_ready inject failed', err);
        }
    });

    const afterData = types?.GENERATE_AFTER_DATA || 'generate_after_data';
    eventSource.on(afterData, (data) => {
        try {
            injectIntoTextCompletion(data);
        } catch (err) {
            console.warn(LOG_PREFIX, 'generate_after_data inject failed', err);
        }
    });
}

function injectIntoTextCompletion(data) {
    const settings = getSettings();
    if (!settings.enabled || !settings.injectEnabled || !currentInjection) return;
    if (!data || typeof data !== 'object') return;
    if (String(data.prompt || '').includes(INJECTION_MARKER)) return;

    if (typeof data.prompt === 'string') {
        data.prompt = `${data.prompt}\n\n${currentInjection}`;
        return;
    }
    if (Array.isArray(data.messages)) {
        const already = data.messages.some((m) => String(m?.content || '').includes(INJECTION_MARKER));
        if (!already) {
            data.messages.push({ role: 'system', content: currentInjection });
        }
    }
}
