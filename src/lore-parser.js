import { LOG_PREFIX } from './constants.js';
import { getWorldInfoModule } from './st-modules.js';

const LORE_CHAR_BUDGET = 14000;
const ENTRY_CHAR_CAP = 900;

/**
 * Deep-parse the current character card, embedded character_book,
 * primary + additional linked lorebooks, global WI, chat-bound WI, and persona WI.
 * @returns {Promise<{
 *  sources: string[],
 *  entries: Array<{source: string, title: string, keys: string[], content: string, constant: boolean}>,
 *  conflicts: string[],
 *  secrets: string[],
 *  npcs: Array<{name: string, role: string, notes: string}>,
 *  factions: Array<{name: string, stance: string, notes: string}>,
 *  artifacts: Array<{name: string, notes: string}>,
 *  taboos: Array<{name: string, notes: string}>,
 *  grandEndgameHint: string,
 *  grandEndgameTitle: string,
 *  digest: string,
 *  coreCanon: string,
 * }>}
 */
export async function parseLoreDeep() {
    const ctx = SillyTavern.getContext();
    const characters = getActiveCharacters(ctx);
    const sources = [];
    const entries = [];

    for (const character of characters) {
        collectCharacterFields(character, entries, sources);
        collectEmbeddedBook(character, ctx, entries, sources);
        await collectLinkedWorlds(character, ctx, entries, sources);
    }

    await collectNamedWorld(ctx.chatMetadata?.world_info, 'chat-bound lorebook', entries, sources);
    await collectGlobalWorlds(entries, sources);
    await collectPersonaWorld(entries, sources);

    const extracted = extractEntitiesAndConflicts(entries);
    const digest = buildDigest(entries, extracted, LORE_CHAR_BUDGET);
    const coreCanon = buildCoreCanon(extracted, entries);

    return {
        sources: unique(sources),
        entries,
        ...extracted,
        digest,
        coreCanon,
    };
}

function getActiveCharacters(ctx) {
    if (ctx.groupId) {
        const group = (ctx.groups || []).find((g) => String(g.id) === String(ctx.groupId));
        const members = group?.members || [];
        return (ctx.characters || []).filter((c) => members.includes(c.avatar));
    }
    if (ctx.characterId != null && ctx.characters?.[ctx.characterId]) {
        return [ctx.characters[ctx.characterId]];
    }
    return [];
}

function collectCharacterFields(character, entries, sources) {
    const data = character?.data || character || {};
    const blobs = [
        ['description', data.description || character.description],
        ['personality', data.personality || character.personality],
        ['scenario', data.scenario || character.scenario],
        ['system_prompt', data.system_prompt],
        ['creator_notes', data.creator_notes || data.creatorcomment],
    ];
    const name = character.name || data.name || 'character';
    sources.push(`character:${name}`);
    for (const [field, text] of blobs) {
        if (!text || !String(text).trim()) continue;
        entries.push({
            source: `character:${name}/${field}`,
            title: `${name} · ${field}`,
            keys: [name, field],
            content: String(text),
            constant: true,
        });
    }
}

function collectEmbeddedBook(character, ctx, entries, sources) {
    const book = character?.data?.character_book;
    if (!book) return;
    const bookName = book.name || `${character.name || 'character'}_book`;
    sources.push(`character_book:${bookName}`);

    let converted = null;
    try {
        converted = ctx.convertCharacterBook?.(book);
    } catch (err) {
        console.warn(LOG_PREFIX, 'convertCharacterBook failed', err);
    }

    const list = converted?.entries
        ? Object.values(converted.entries)
        : Array.isArray(book.entries) ? book.entries : Object.values(book.entries || {});

    for (const entry of list) {
        pushWorldEntry(entries, `character_book:${bookName}`, entry);
    }
}

async function collectLinkedWorlds(character, ctx, entries, sources) {
    const data = character?.data || {};
    const ext = data.extensions || character.extensions || {};
    const names = [];

    if (ext.world) names.push(ext.world);
    if (Array.isArray(ext.linked_world_info)) names.push(...ext.linked_world_info);
    if (typeof ext.linked_world_info === 'string' && ext.linked_world_info) names.push(ext.linked_world_info);
    if (Array.isArray(character.linked_world_info)) names.push(...character.linked_world_info);

    const wi = await getWorldInfoModule();
    const fileName = character.avatar || '';
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const extra = (wi?.world_info?.charLore || []).find((e) =>
        e.name === fileName || e.name === baseName || e.name === character.name);
    if (extra?.extraBooks) names.push(...extra.extraBooks);

    for (const worldName of unique(names.filter(Boolean))) {
        await collectNamedWorld(worldName, `linked_world_info:${worldName}`, entries, sources);
    }
}

async function collectGlobalWorlds(entries, sources) {
    const wi = await getWorldInfoModule();
    const selected = wi?.selected_world_info;
    if (!Array.isArray(selected)) return;
    for (const name of selected) {
        await collectNamedWorld(name, `global:${name}`, entries, sources);
    }
}

async function collectPersonaWorld(entries, sources) {
    const ctx = SillyTavern.getContext();
    const personaBook = ctx.powerUserSettings?.persona_description_lorebook;
    if (personaBook) {
        await collectNamedWorld(personaBook, `persona:${personaBook}`, entries, sources);
    }
}

async function collectNamedWorld(worldName, sourceLabel, entries, sources) {
    if (!worldName) return;
    const ctx = SillyTavern.getContext();
    try {
        const data = await ctx.loadWorldInfo?.(worldName);
        if (!data?.entries) return;
        sources.push(sourceLabel);
        for (const entry of Object.values(data.entries)) {
            if (entry?.disable) continue;
            pushWorldEntry(entries, sourceLabel, entry);
        }
    } catch (err) {
        console.warn(LOG_PREFIX, 'loadWorldInfo failed for', worldName, err);
    }
}

function pushWorldEntry(entries, source, entry) {
    const content = entry.content || entry.entry || '';
    if (!content || entry.disable || entry.enabled === false) return;
    const keys = [].concat(entry.key || entry.keys || []).map(String).filter(Boolean);
    entries.push({
        source,
        title: entry.comment || entry.name || keys[0] || 'untitled',
        keys,
        content: String(content).slice(0, ENTRY_CHAR_CAP * 2),
        constant: Boolean(entry.constant),
    });
}

function extractEntitiesAndConflicts(entries) {
    const conflicts = [];
    const secrets = [];
    const npcs = [];
    const factions = [];
    const artifacts = [];
    const taboos = [];

    const factionRe = /(阵营|势力|宗门|公会|帝国|王朝|家族|帮派|财阀|教会|议会|同盟|叛军|faction|empire|clan|guild|house|syndicate|cartel)/i;
    const conflictRe = /(冲突|战争|覆灭|政变|争夺|黑预算|阴谋|对抗|崩溃|危机|war|conspiracy|coup|collapse|crisis|rival)/i;
    const secretRe = /(秘密|绝密|禁忌真相|未解|悬念|黑幕|hidden|secret|classified|cover[- ]?up)/i;
    const npcRe = /(npc|人物|角色|导师|反派|线人|君主|宗主|董事|特工)/i;
    const artifactRe = /(神器|秘宝|钥匙|样本|档案|芯片|契约|遗物|artifact|relic|key item)/i;
    const tabooRe = /(禁忌|禁术|不可提及|天条|戒律|taboo|forbidden)/i;

    for (const entry of entries) {
        const blob = `${entry.title}\n${entry.keys.join(',')}\n${entry.content}`;
        const snippet = clip(entry.content, 220);
        if (conflictRe.test(blob)) conflicts.push(`${entry.title}: ${snippet}`);
        if (secretRe.test(blob)) secrets.push(`${entry.title}: ${snippet}`);
        if (factionRe.test(blob)) factions.push({ name: entry.title, stance: '从世界书推断', notes: snippet });
        if (npcRe.test(blob) || (entry.keys.length && entry.keys[0].length <= 12 && !factionRe.test(blob))) {
            if (npcRe.test(blob)) npcs.push({ name: entry.keys[0] || entry.title, role: '世界书人物', notes: snippet });
        }
        if (artifactRe.test(blob)) artifacts.push({ name: entry.title, notes: snippet });
        if (tabooRe.test(blob)) taboos.push({ name: entry.title, notes: snippet });
    }

    const endgameSource = conflicts[0] || secrets[0] || entries.find((e) => e.constant)?.content || '';
    const grandEndgameTitle = pickEndgameTitle(conflicts, factions);
    const grandEndgameHint = clip(endgameSource, 400);

    return {
        conflicts: unique(conflicts).slice(0, 12),
        secrets: unique(secrets).slice(0, 12),
        npcs: dedupeByName(npcs).slice(0, 12),
        factions: dedupeByName(factions).slice(0, 12),
        artifacts: dedupeByName(artifacts).slice(0, 8),
        taboos: dedupeByName(taboos).slice(0, 8),
        grandEndgameHint,
        grandEndgameTitle,
    };
}

function pickEndgameTitle(conflicts, factions) {
    if (conflicts[0]) {
        const head = conflicts[0].split(':')[0].trim();
        return head || '世界最高冲突';
    }
    if (factions.length >= 2) {
        return `${factions[0].name} 与 ${factions[1].name} 的终局对撞`;
    }
    return '尚未命名的终局';
}

function buildDigest(entries, extracted, budget) {
    const header = [
        `【已锁定冲突】\n${extracted.conflicts.slice(0, 6).join('\n') || '（未直接检出，需由导演从原文归纳）'}`,
        `【未解悬念 / 终极秘密】\n${extracted.secrets.slice(0, 6).join('\n') || '（未直接检出）'}`,
        `【阵营】${extracted.factions.map((f) => f.name).join('、') || '未知'}`,
        `【核心人物】${extracted.npcs.map((n) => n.name).join('、') || '未知'}`,
        `【绝密物品】${extracted.artifacts.map((a) => a.name).join('、') || '未知'}`,
        `【规则忌讳】${extracted.taboos.map((t) => t.name).join('、') || '未知'}`,
    ].join('\n\n');

    const prioritized = [...entries].sort((a, b) => Number(b.constant) - Number(a.constant));
    let used = header.length;
    const body = [];
    for (const entry of prioritized) {
        const block = `## ${entry.title} [${entry.source}]\nKeys: ${entry.keys.join(', ')}\n${clip(entry.content, ENTRY_CHAR_CAP)}`;
        if (used + block.length > budget) break;
        body.push(block);
        used += block.length;
    }
    return `${header}\n\n【世界书原文摘录】\n${body.join('\n\n')}`;
}

function buildCoreCanon(extracted, entries) {
    const constants = entries.filter((e) => e.constant).slice(0, 10).map((e) => `- ${e.title}: ${clip(e.content, 180)}`);
    return [
        `终局冲突：${extracted.grandEndgameTitle}`,
        `悬念：${extracted.secrets.slice(0, 5).join(' | ')}`,
        `阵营：${extracted.factions.map((f) => f.name).join('、')}`,
        `忌讳：${extracted.taboos.map((t) => t.name).join('、')}`,
        constants.length ? `恒定条目：\n${constants.join('\n')}` : '',
    ].filter(Boolean).join('\n');
}

function clip(text, n) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function unique(arr) {
    return [...new Set(arr.filter(Boolean))];
}

function dedupeByName(arr) {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
        const key = (item.name || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}
