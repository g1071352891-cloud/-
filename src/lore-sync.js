import { DYNAMIC_LORE_GROUP, DYNAMIC_LORE_TAG, LOG_PREFIX, NODE_STATUS } from './constants.js';
import { getSettings } from './settings.js';
import { getWorldInfoModule } from './st-modules.js';
import { getChatKey } from './chat-store.js';

const CHAT_BOOK_META = 'world_info';

/**
 * Ensure a chat-bound lorebook exists, then upsert entries for new/replaced nodes
 * and newly introduced entities. Tagged with [DM_Dynamic_Node].
 * @param {import('./graph.js').MainPlotGraph} graph
 */
export async function syncDynamicLore(graph) {
    const settings = getSettings();
    if (!settings.syncLorebook || !graph) return;

    const ctx = SillyTavern.getContext();
    if (!ctx.getCurrentChatId?.() && !ctx.chatId) return;

    const bookName = await ensureChatBoundBook();
    if (!bookName) return;

    const data = await ctx.loadWorldInfo(bookName);
    if (!data) return;
    if (!data.entries) data.entries = {};

    const wi = await getWorldInfoModule();
    const liveNodes = (graph.nodes || []).filter((n) => n.status !== NODE_STATUS.REROUTED);
    const upserts = [];

    for (const node of liveNodes) {
        upserts.push({
            trackKey: `node:${node.id}`,
            title: `${DYNAMIC_LORE_TAG} ${node.title}`,
            keys: uniqueKeys([node.title, node.id, ...(node.clues || []).slice(0, 3)]),
            content: formatNodeLore(graph, node),
            constant: true,
        });
    }

    for (const npc of graph.entities?.npcs || []) {
        if (npc.status === 'existing') continue;
        if (!shouldSyncEntity(npc, graph)) continue;
        upserts.push({
            trackKey: `npc:${npc.name}`,
            title: `${DYNAMIC_LORE_TAG} NPC · ${npc.name}`,
            keys: uniqueKeys([npc.name]),
            content: `${npc.name}（动态登场/状态更新）\n职责：${npc.role || '未知'}\n状态：${npc.status || 'active'}\n${npc.notes || ''}\n与终极主线的关系：${graph.grandEndgame.title}`,
            constant: false,
        });
    }

    for (const placeLike of [...(graph.entities?.artifacts || [])]) {
        if (!shouldSyncEntity(placeLike, graph)) continue;
        upserts.push({
            trackKey: `artifact:${placeLike.name}`,
            title: `${DYNAMIC_LORE_TAG} ${placeLike.name}`,
            keys: uniqueKeys([placeLike.name]),
            content: `${placeLike.name}\n${placeLike.notes || ''}\n此物与终极主线「${graph.grandEndgame.title}」绑定。`,
            constant: false,
        });
    }

    graph.loreEntryUids = graph.loreEntryUids || {};
    let mutated = false;

    for (const item of upserts) {
        const existingUid = graph.loreEntryUids[item.trackKey];
        let entry = existingUid != null ? data.entries[existingUid] : findTaggedEntry(data, item.title);
        if (!entry) {
            entry = createEntry(wi, bookName, data);
            if (!entry) continue;
            mutated = true;
        }
        const before = entry.content;
        entry.comment = item.title;
        entry.content = item.content;
        entry.key = item.keys;
        entry.constant = item.constant;
        entry.addMemo = true;
        entry.group = DYNAMIC_LORE_GROUP;
        entry.disable = false;
        entry.probability = 100;
        entry.useProbability = false;
        graph.loreEntryUids[item.trackKey] = entry.uid;
        if (before !== item.content) mutated = true;
    }

    if (mutated) {
        await ctx.saveWorldInfo(bookName, data, true);
        await ctx.updateWorldInfoList?.();
        console.debug(LOG_PREFIX, 'Synced dynamic lore into', bookName);
    }
}

async function ensureChatBoundBook() {
    const ctx = SillyTavern.getContext();
    const existing = ctx.chatMetadata?.[CHAT_BOOK_META];
    const known = ctx.getWorldInfoNames?.() || [];
    if (existing && (!known.length || known.includes(existing))) {
        return existing;
    }

    const chatKey = getChatKey().replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40);
    const bookName = `UAI-DM_${chatKey || 'chat'}`;

    if (!known.includes(bookName)) {
        const wi = await getWorldInfoModule();
        if (typeof wi?.createNewWorldInfo === 'function') {
            await wi.createNewWorldInfo(bookName, { interactive: false });
        } else {
            await ctx.saveWorldInfo(bookName, { entries: {} }, true);
            await ctx.updateWorldInfoList?.();
        }
    }

    ctx.chatMetadata[CHAT_BOOK_META] = bookName;
    await ctx.saveMetadata?.();
    try {
        document.querySelector('.chat_lorebook_button')?.classList.add('world_set');
    } catch {
        // ignore DOM
    }
    return bookName;
}

function createEntry(wi, bookName, data) {
    if (typeof wi?.createWorldInfoEntry === 'function') {
        return wi.createWorldInfoEntry(bookName, data);
    }
    const uids = Object.keys(data.entries || {}).map(Number).filter(Number.isInteger);
    const uid = (uids.length ? Math.max(...uids) : -1) + 1;
    const entry = {
        uid,
        key: [],
        keysecondary: [],
        comment: '',
        content: '',
        constant: false,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        order: 120,
        position: 0,
        disable: false,
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: false,
        depth: 4,
        group: DYNAMIC_LORE_GROUP,
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: 0,
        sticky: null,
        cooldown: null,
        delay: null,
        displayIndex: uid,
        outletName: '',
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        triggers: [],
    };
    data.entries[uid] = entry;
    return entry;
}

function findTaggedEntry(data, title) {
    return Object.values(data.entries || {}).find((e) => e?.comment === title);
}

function formatNodeLore(graph, node) {
    return [
        `${DYNAMIC_LORE_TAG}`,
        `里程碑：【节点${node.id}: ${node.title}】`,
        `状态：${node.status}`,
        `内容：${node.description}`,
        node.clues?.length ? `线索：${node.clues.join('；')}` : '',
        `此节点服务于终极主线：${graph.grandEndgame.title}`,
        `终局摘要：${graph.grandEndgame.summary}`,
        node.reroutedFrom ? `由旧节点 ${node.reroutedFrom} 重路由而来，禁止复原旧路径。` : '',
    ].filter(Boolean).join('\n');
}

function shouldSyncEntity(entity, graph) {
    if (!entity?.name) return false;
    if (entity.dynamic || entity.temporary) return true;
    if (!graph.lastReroute?.newNodeIds?.length) return false;
    return entity.status !== 'canon';
}

function uniqueKeys(list) {
    return [...new Set(list.map((k) => String(k || '').trim()).filter((k) => k.length >= 1))].slice(0, 8);
}
