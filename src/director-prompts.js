import { LOG_PREFIX, PLOT_COMPLEXITY_LABELS } from './constants.js';
import { callDirector, parseJsonLoose } from './director-api.js';

const GRAPH_SCHEMA = {
    name: 'MainPlotGraph',
    description: 'A multi-tier main plot graph locked to lorebook endgame.',
    strict: false,
    value: {
        type: 'object',
        properties: {
            grandEndgame: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    source: { type: 'string' },
                    conflicts: { type: 'array', items: { type: 'string' } },
                    secrets: { type: 'array', items: { type: 'string' } },
                },
            },
            nodes: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        title: { type: 'string' },
                        description: { type: 'string' },
                        status: { type: 'string' },
                        clues: { type: 'array', items: { type: 'string' } },
                        thread: { type: 'string' },
                    },
                },
            },
            entities: {
                type: 'object',
                properties: {
                    npcs: { type: 'array', items: { type: 'object' } },
                    factions: { type: 'array', items: { type: 'object' } },
                    artifacts: { type: 'array', items: { type: 'object' } },
                    taboos: { type: 'array', items: { type: 'object' } },
                },
            },
            worldStatus: { type: 'string' },
        },
    },
};

const REROUTE_SCHEMA = {
    name: 'ReRouteDecision',
    description: 'Whether and how to rewrite live subplot nodes toward the locked endgame.',
    strict: false,
    value: {
        type: 'object',
        properties: {
            shouldReroute: { type: 'boolean' },
            deviationScore: { type: 'number' },
            userAction: { type: 'string' },
            invalidatedNodeIds: { type: 'array', items: { type: 'string' } },
            completedNodeIds: { type: 'array', items: { type: 'string' } },
            newNodes: { type: 'array', items: { type: 'object' } },
            worldReaction: { type: 'string' },
            worldStatus: { type: 'string' },
            entities: { type: 'object' },
            grandEndgame: { type: 'object' },
        },
    },
};

const REVIEW_SCHEMA = {
    name: 'ConsistencyReview',
    strict: false,
    value: {
        type: 'object',
        properties: {
            hasViolations: { type: 'boolean' },
            violations: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        quote: { type: 'string' },
                        against: { type: 'string' },
                        suggestion: { type: 'string' },
                    },
                },
            },
            summary: { type: 'string' },
        },
    },
};

export async function requestInitialGraph({ lore, complexity, identity, recentChat }) {
    const nodeHint = complexity === 'linear' ? 'exactly 3 sequential milestone nodes'
        : complexity === 'dual' ? 'exactly 4 nodes on two interwoven threads that later collide'
            : 'exactly 5 interconnected conspiracy nodes across multiple factions';

    const system = [
        'You are a senior tabletop director for SillyTavern.',
        'Build a MainPlotGraph from the character card and lorebook. Do not invent a replacement setting that contradicts the lore.',
        'Grand Endgame MUST be the highest conflict already implied by the lorebook. Lock it. It must not vanish if the player goes off-script later.',
        'Bind core NPCs, factions, secret items, and taboos from the lore to nodes.',
        `Plot complexity: ${PLOT_COMPLEXITY_LABELS[complexity] || complexity} — ${nodeHint}.`,
        'Node titles should look like 【节点A: 关键线索】 style beats, written in the same language as the lore.',
        'Reply with a single JSON object. No markdown.',
    ].join('\n');

    const user = [
        `Character: ${identity.characterName}`,
        `Chat: ${identity.chatKey}`,
        '',
        '=== LORE DIGEST ===',
        lore.digest,
        '',
        '=== RECENT CHAT (optional seed) ===',
        recentChat || '(new chat)',
        '',
        'JSON shape:',
        '{ "grandEndgame": { "title", "summary", "source", "conflicts":[], "secrets":[] }, "nodes":[{ "id","title","description","status","clues":[],"thread" }], "entities": { "npcs":[{"name","role","notes"}], "factions":[{"name","stance","notes"}], "artifacts":[{"name","notes"}], "taboos":[{"name","notes"}] }, "worldStatus": "..." }',
        'First live node status=active, later nodes status=pending.',
    ].join('\n');

    const raw = await callDirector({ system, user, jsonSchema: GRAPH_SCHEMA, maxTokens: 4096, temperature: 0.4 });
    return parseJsonLoose(raw);
}

export async function requestReroute({ graph, lore, recentChat, sensitivity }) {
    const liveNodes = (graph.nodes || []).filter((n) => n.status !== 'rerouted');
    const system = [
        'You are a dynamic re-routing engine for an ongoing roleplay.',
        'NON-RESTORATION RULE: if the player destroyed, skipped, or invalidated a node, NEVER restore it. NEVER scold the player. NEVER rail-road them back onto the old beat.',
        'Instead, invent replacement nodes (A → A′) that still funnel toward the LOCKED Grand Endgame via new causal chains.',
        'The world must react: factions/NPCs/taboos shift in the shadow of the endgame.',
        'If the player is only mildly exploratory, do not reroute. If they killed a key NPC, joined an enemy faction, collapsed into slice-of-life, or wrecked the current plan, reroute.',
        `Sensitivity (0-100, higher = reroute more eagerly): ${sensitivity}.`,
        'deviationScore is 0..1. Recommend shouldReroute=true when deviationScore is clearly above the implied threshold.',
        'Reply with a single JSON object. No markdown. Same language as the lore/chat.',
    ].join('\n');

    const user = [
        '=== LOCKED GRAND ENDGAME (must survive) ===',
        JSON.stringify(graph.grandEndgame, null, 2),
        '',
        '=== CURRENT NODES ===',
        JSON.stringify(liveNodes, null, 2),
        '',
        '=== ENTITIES ===',
        JSON.stringify(graph.entities, null, 2),
        '',
        '=== CORE CANON ===',
        lore.coreCanon,
        '',
        '=== LAST ~10 TURNS ===',
        recentChat,
        '',
        'JSON shape:',
        '{ "shouldReroute": false, "deviationScore": 0.0, "userAction": "", "invalidatedNodeIds": [], "completedNodeIds": [], "newNodes": [{ "id","title","description","status","clues":[],"reroutedFrom","thread" }], "worldReaction": "", "worldStatus": "", "entities": {}, "grandEndgame": { "shadow": "optional new manifestation, do not replace title" } }',
        'If shouldReroute is false, still fill userAction, deviationScore, completedNodeIds if a beat was naturally achieved, and an updated worldStatus.',
    ].join('\n');

    const raw = await callDirector({ system, user, jsonSchema: REROUTE_SCHEMA, maxTokens: 3072, temperature: 0.45 });
    return parseJsonLoose(raw);
}

export async function requestConsistencyReview({ lore, recentChat, graph }) {
    const system = [
        'You are a lore consistency reviewer for an ongoing roleplay.',
        'Flag only genuine contradictions against CORE canon from the lorebook / locked endgame (eating the book): wrong names, broken metaphysics, resurrected dead NPCs without cause, faction facts inverted, taboo violations treated as normal, etc.',
        'Style drift, omitted details, or player-driven plot twists that the world could absorb are NOT violations.',
        'Reply with JSON only.',
    ].join('\n');

    const user = [
        '=== CORE CANON ===',
        lore.coreCanon,
        '',
        '=== LOCKED ENDGAME ===',
        `${graph?.grandEndgame?.title || ''}: ${graph?.grandEndgame?.summary || ''}`,
        '',
        '=== LAST 5 TURNS ===',
        recentChat,
        '',
        '{ "hasViolations": false, "summary": "", "violations": [{ "quote": "对话原句或转述", "against": "被违背的世界书设定", "suggestion": "如何在后续回合不着痕迹地圆回来" }] }',
    ].join('\n');

    const raw = await callDirector({ system, user, jsonSchema: REVIEW_SCHEMA, maxTokens: 2048, temperature: 0.2 });
    try {
        return parseJsonLoose(raw);
    } catch (err) {
        console.warn(LOG_PREFIX, 'Consistency JSON parse failed', err);
        return { hasViolations: false, summary: String(raw).slice(0, 400), violations: [] };
    }
}
