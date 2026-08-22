import { CHAT_META_KEY } from './constants.js';

export function getChatKey() {
    const ctx = SillyTavern.getContext();
    return String(ctx.getCurrentChatId?.() || ctx.chatId || 'no-chat');
}

export function getCharacterName() {
    const ctx = SillyTavern.getContext();
    return ctx.name2 || ctx.characters?.[ctx.characterId]?.name || 'Unknown';
}

export function getChatBundle() {
    const ctx = SillyTavern.getContext();
    const meta = ctx.chatMetadata || {};
    if (!meta[CHAT_META_KEY] || typeof meta[CHAT_META_KEY] !== 'object') {
        meta[CHAT_META_KEY] = { graph: null, logs: [], lastEvalAt: 0 };
    }
    return meta[CHAT_META_KEY];
}

export async function persistChatBundle(patch) {
    const ctx = SillyTavern.getContext();
    const bundle = getChatBundle();
    Object.assign(bundle, patch);
    ctx.chatMetadata[CHAT_META_KEY] = bundle;
    if (typeof ctx.saveMetadata === 'function') {
        await ctx.saveMetadata();
    } else {
        ctx.saveMetadataDebounced?.();
    }
}

/**
 * @param {number} [limit=10]
 * @returns {string}
 */
export function getRecentTranscript(limit = 10) {
    const ctx = SillyTavern.getContext();
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const slice = chat.filter((m) => m && !m.is_system && m.mes).slice(-limit);
    return slice.map((m) => {
        const who = m.is_user ? (ctx.name1 || 'User') : (m.name || ctx.name2 || 'Char');
        return `${who}: ${String(m.mes).replace(/<[^>]+>/g, '').slice(0, 800)}`;
    }).join('\n\n');
}

export function getVisibleMessageCount() {
    const ctx = SillyTavern.getContext();
    return (ctx.chat || []).filter((m) => m && !m.is_system).length;
}

export function appendLog(line) {
    const bundle = getChatBundle();
    bundle.logs = Array.isArray(bundle.logs) ? bundle.logs : [];
    bundle.logs.push({ at: Date.now(), line: String(line) });
    if (bundle.logs.length > 80) bundle.logs = bundle.logs.slice(-80);
    SillyTavern.getContext().saveMetadataDebounced?.();
    return bundle.logs;
}
