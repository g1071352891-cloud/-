import { INJECTION_MARKER, NODE_COUNT_BY_COMPLEXITY, NODE_STATUS, PLOT_COMPLEXITY } from './constants.js';

/**
 * @typedef {object} PlotEntity
 * @property {string} id
 * @property {string} name
 * @property {string} [role]
 * @property {string} [stance]
 * @property {string} [status]
 * @property {string} notes
 * @property {string[]} [boundNodeIds]
 */

/**
 * @typedef {object} PlotNode
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} status
 * @property {string|null} replacedBy
 * @property {string|null} reroutedFrom
 * @property {string[]} clues
 * @property {string} [thread]
 * @property {number} [generation]
 * @property {string[]} [dependsOn]
 */

/**
 * @typedef {object} MainPlotGraph
 * @property {number} version
 * @property {string} chatKey
 * @property {string} characterName
 * @property {number} builtAt
 * @property {number} updatedAt
 * @property {number} lastEvaluatedMessageCount
 * @property {string} complexity
 * @property {{ title: string, summary: string, source: string, locked: boolean, conflicts: string[], secrets: string[] }} grandEndgame
 * @property {PlotNode[]} nodes
 * @property {{ npcs: PlotEntity[], factions: PlotEntity[], artifacts: PlotEntity[], taboos: PlotEntity[] }} entities
 * @property {string} worldStatus
 * @property {object|null} lastReroute
 * @property {string} injectionText
 * @property {string[]} loreSources
 * @property {Record<string, number>} loreEntryUids
 */

/**
 * @param {object} [partial]
 * @returns {MainPlotGraph}
 */
export function createEmptyGraph(partial = {}) {
    const now = Date.now();
    return {
        version: 1,
        chatKey: '',
        characterName: '',
        builtAt: now,
        updatedAt: now,
        lastEvaluatedMessageCount: 0,
        complexity: PLOT_COMPLEXITY.WEB,
        grandEndgame: {
            title: '未锁定的终局',
            summary: '尚未从世界书中抽取出足够的最高冲突。打开角色卡与世界书后，导演会自动锁定终极主线。',
            source: '',
            locked: false,
            conflicts: [],
            secrets: [],
        },
        nodes: [],
        entities: {
            npcs: [],
            factions: [],
            artifacts: [],
            taboos: [],
        },
        worldStatus: '世界尚在静默中。尚未根据玩家行动产生可观测的暗流。',
        lastReroute: null,
        injectionText: '',
        loreSources: [],
        loreEntryUids: {},
        ...partial,
    };
}

/**
 * @param {MainPlotGraph} graph
 * @returns {PlotNode[]}
 */
export function getLiveNodes(graph) {
    return (graph?.nodes || []).filter((n) => n.status !== NODE_STATUS.REROUTED);
}

/**
 * @param {MainPlotGraph} graph
 * @returns {PlotNode[]}
 */
export function getActivePath(graph) {
    const live = getLiveNodes(graph);
    const completed = live.filter((n) => n.status === NODE_STATUS.COMPLETED);
    const active = live.filter((n) => n.status === NODE_STATUS.ACTIVE);
    const pending = live.filter((n) => n.status === NODE_STATUS.PENDING);
    return [...completed, ...active, ...pending];
}

/**
 * @param {number} index
 * @param {number} generation
 * @returns {string}
 */
export function makeNodeId(index, generation = 0) {
    const letters = 'ABCDEFGH';
    const base = letters[index] || `N${index + 1}`;
    return generation > 0 ? `${base}_r${generation}` : base;
}

/**
 * Apply a reroute payload onto the in-memory graph without resurrecting invalidated nodes.
 * @param {MainPlotGraph} graph
 * @param {object} reroute
 * @returns {MainPlotGraph}
 */
export function applyReroute(graph, reroute) {
    const invalidated = new Set(reroute.invalidatedNodeIds || []);
    const now = Date.now();
    const maxGen = Math.max(0, ...graph.nodes.map((n) => n.generation || 0));
    const generation = maxGen + 1;

    for (const node of graph.nodes) {
        if (invalidated.has(node.id) && node.status !== NODE_STATUS.REROUTED) {
            node.status = NODE_STATUS.REROUTED;
        }
    }

    const newNodes = Array.isArray(reroute.newNodes) ? reroute.newNodes : [];
    const created = [];
    newNodes.forEach((incoming, idx) => {
        const id = incoming.id || makeNodeId(idx, generation);
        const node = {
            id,
            title: incoming.title || `新节点 ${id}`,
            description: incoming.description || '',
            status: incoming.status || NODE_STATUS.ACTIVE,
            replacedBy: null,
            reroutedFrom: incoming.reroutedFrom || [...invalidated][idx] || [...invalidated][0] || null,
            clues: Array.isArray(incoming.clues) ? incoming.clues : [],
            thread: incoming.thread || '',
            generation,
            dependsOn: Array.isArray(incoming.dependsOn) ? incoming.dependsOn : [],
        };
        graph.nodes.push(node);
        created.push(node);
        if (node.reroutedFrom) {
            const old = graph.nodes.find((n) => n.id === node.reroutedFrom);
            if (old) old.replacedBy = node.id;
        }
    });

    if (Array.isArray(reroute.completedNodeIds)) {
        for (const id of reroute.completedNodeIds) {
            const node = graph.nodes.find((n) => n.id === id);
            if (node && node.status !== NODE_STATUS.REROUTED) {
                node.status = NODE_STATUS.COMPLETED;
            }
        }
    }

    if (reroute.grandEndgame && graph.grandEndgame.locked) {
        // Endgame is locked: only allow shadow/form updates, never erasure.
        if (reroute.grandEndgame.shadow) {
            graph.grandEndgame.summary = `${graph.grandEndgame.summary}\n\n终局投影变化：${reroute.grandEndgame.shadow}`;
        }
    } else if (reroute.grandEndgame?.title) {
        Object.assign(graph.grandEndgame, reroute.grandEndgame, { locked: true });
    }

    mergeEntities(graph.entities, reroute.entities);

    graph.worldStatus = reroute.worldStatus || graph.worldStatus;
    graph.lastReroute = {
        at: now,
        userAction: reroute.userAction || '',
        oldNodeIds: [...invalidated],
        newNodeIds: created.map((n) => n.id),
        worldReaction: reroute.worldReaction || '',
        deviationScore: Number(reroute.deviationScore) || 0,
    };
    graph.updatedAt = now;
    return graph;
}

function mergeEntities(target, incoming) {
    if (!incoming || typeof incoming !== 'object') return;
    for (const bucket of ['npcs', 'factions', 'artifacts', 'taboos']) {
        if (!Array.isArray(incoming[bucket])) continue;
        if (!Array.isArray(target[bucket])) target[bucket] = [];
        for (const item of incoming[bucket]) {
            if (!item?.name) continue;
            const existing = target[bucket].find((e) => e.name === item.name);
            if (existing) {
                Object.assign(existing, item);
            } else {
                target[bucket].push({
                    id: item.id || slugId(item.name),
                    name: item.name,
                    role: item.role || '',
                    stance: item.stance || '',
                    status: item.status || 'active',
                    notes: item.notes || '',
                    boundNodeIds: item.boundNodeIds || [],
                });
            }
        }
    }
}

export function slugId(name) {
    return String(name || 'entity')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\u4e00-\u9fff-]/g, '')
        .slice(0, 48) || `e-${Date.now()}`;
}

/**
 * Seed a heuristic graph when the director LLM is unavailable.
 * @param {object} parsedLore
 * @param {string} complexity
 * @param {object} identity
 * @returns {MainPlotGraph}
 */
export function seedHeuristicGraph(parsedLore, complexity, identity) {
    const count = NODE_COUNT_BY_COMPLEXITY[complexity] || 5;
    const endgame = parsedLore.grandEndgameHint || '从世界书冲突中生长出的未竟终局';
    const graph = createEmptyGraph({
        chatKey: identity.chatKey,
        characterName: identity.characterName,
        complexity,
        loreSources: parsedLore.sources || [],
        grandEndgame: {
            title: parsedLore.grandEndgameTitle || '世界最高冲突',
            summary: endgame,
            source: (parsedLore.sources || []).join(' / '),
            locked: Boolean(parsedLore.grandEndgameHint),
            conflicts: parsedLore.conflicts.slice(0, 6),
            secrets: parsedLore.secrets.slice(0, 6),
        },
        worldStatus: '终极主线已根据世界书锁定。玩家尚未大幅改写局势，暗流仍按原脉络潜行。',
        entities: {
            npcs: parsedLore.npcs.slice(0, 8).map((n) => ({ id: slugId(n.name), name: n.name, role: n.role || '核心人物', notes: n.notes || '', status: 'alive', boundNodeIds: [] })),
            factions: parsedLore.factions.slice(0, 8).map((n) => ({ id: slugId(n.name), name: n.name, stance: n.stance || '未知', notes: n.notes || '', status: 'active', boundNodeIds: [] })),
            artifacts: parsedLore.artifacts.slice(0, 6).map((n) => ({ id: slugId(n.name), name: n.name, notes: n.notes || '', boundNodeIds: [] })),
            taboos: parsedLore.taboos.slice(0, 6).map((n) => ({ id: slugId(n.name), name: n.name, notes: n.notes || '', boundNodeIds: [] })),
        },
    });

    const templates = defaultNodeTemplates(complexity);
    graph.nodes = templates.slice(0, count).map((tpl, i) => ({
        id: makeNodeId(i, 0),
        title: tpl.title,
        description: tpl.description,
        status: i === 0 ? NODE_STATUS.ACTIVE : NODE_STATUS.PENDING,
        replacedBy: null,
        reroutedFrom: null,
        clues: [],
        thread: tpl.thread,
        generation: 0,
        dependsOn: i > 0 ? [makeNodeId(i - 1, 0)] : [],
    }));

    graph.injectionText = buildInjectionText(graph, {
        userAction: '玩家刚进入当前场景',
        oldNodeTitle: '（尚无失效节点）',
        newNode: graph.nodes[0],
    });
    return graph;
}

function defaultNodeTemplates(complexity) {
    if (complexity === PLOT_COMPLEXITY.LINEAR) {
        return [
            { title: '关键线索', description: '让玩家在当前场景中撞上通往终局的第一枚物证或证人。', thread: '主线' },
            { title: '阵营摊牌', description: '迫使玩家在相互敌对的势力之间做出不可逆的站队或背叛。', thread: '主线' },
            { title: '破局钥匙', description: '交出足以撬动终极主线的关键手段、地点或秘密。', thread: '主线' },
        ];
    }
    if (complexity === PLOT_COMPLEXITY.DUAL) {
        return [
            { title: '明线：关键线索', description: '表面事件中的可追线索。', thread: '明线' },
            { title: '暗线：隐藏把柄', description: '另一股势力同时布局的把柄或人质。', thread: '暗线' },
            { title: '双线交汇', description: '两条线在同一现场对撞，玩家无法再装看不见。', thread: '交汇' },
            { title: '破局钥匙', description: '交汇之后唯一能撬动终局的手段。', thread: '主线' },
        ];
    }
    return [
        { title: '关键线索', description: '某条被世界书埋藏的裂缝第一次对玩家可见。', thread: '线索' },
        { title: '阵营试探', description: '至少一个核心阵营开始把玩家当成棋子或威胁。', thread: '阵营' },
        { title: '禁忌越界', description: '玩家触及规则忌讳或绝密物品的边缘。', thread: '禁忌' },
        { title: '阵营摊牌', description: '多方阴谋同时见光，旧路径失效。', thread: '摊牌' },
        { title: '破局钥匙', description: '通往终极主线高潮的不可替代杠杆。', thread: '终局' },
    ];
}

/**
 * @param {MainPlotGraph} graph
 * @param {{ userAction: string, oldNodeTitle: string, newNode?: PlotNode|null }} ctx
 */
export function buildInjectionText(graph, ctx) {
    const live = getActivePath(graph);
    const focus = ctx.newNode || live.find((n) => n.status === NODE_STATUS.ACTIVE) || live[0];
    const focusTitle = focus ? `【节点${focus.id}: ${focus.title}】` : '（新的可推进节点）';
    const clues = focus?.clues?.length ? focus.clues.join('；') : (focus?.description || '一条尚未说破的后果');
    return [
        `${INJECTION_MARKER}：`,
        `1. 终极主线设定：${graph.grandEndgame.title} — ${graph.grandEndgame.summary}`,
        `2. 局势演变：由于玩家刚才做出了 ${ctx.userAction || '一次偏离原计划的行动'}，原定的 ${ctx.oldNodeTitle || '旧节点'} 已失效。`,
        `3. 当前全新推进路径：请配合玩家目前的行动，并在剧情中自然呈现 ${focusTitle} 的线索/后果（${clues}）。`,
        `4. 表现要求：顺应玩家的自由选择，将新线索隐蔽地缝合进玩家当前的交互场景中。不要纠正玩家，不要复原被破坏的旧节点，不要跳出角色讲解导演指令。`,
        graph.worldStatus ? `5. 世界暗流：${graph.worldStatus}` : '',
    ].filter(Boolean).join('\n');
}

/**
 * Normalize a loosely-parsed LLM graph into MainPlotGraph.
 * @param {object} raw
 * @param {object} identity
 * @param {string} complexity
 * @returns {MainPlotGraph}
 */
export function normalizeGraphFromLlm(raw, identity, complexity) {
    const graph = createEmptyGraph({
        chatKey: identity.chatKey,
        characterName: identity.characterName,
        complexity,
        loreSources: identity.loreSources || [],
    });

    if (raw?.grandEndgame) {
        graph.grandEndgame = {
            title: raw.grandEndgame.title || graph.grandEndgame.title,
            summary: raw.grandEndgame.summary || graph.grandEndgame.summary,
            source: raw.grandEndgame.source || (identity.loreSources || []).join(' / '),
            locked: true,
            conflicts: asStringArray(raw.grandEndgame.conflicts),
            secrets: asStringArray(raw.grandEndgame.secrets),
        };
    }

    const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
    const wanted = NODE_COUNT_BY_COMPLEXITY[complexity] || 5;
    graph.nodes = nodes.slice(0, Math.max(wanted, nodes.length)).map((n, i) => ({
        id: String(n.id || makeNodeId(i, 0)),
        title: n.title || `节点 ${i + 1}`,
        description: n.description || '',
        status: Object.values(NODE_STATUS).includes(n.status) ? n.status : (i === 0 ? NODE_STATUS.ACTIVE : NODE_STATUS.PENDING),
        replacedBy: n.replacedBy || null,
        reroutedFrom: n.reroutedFrom || null,
        clues: asStringArray(n.clues),
        thread: n.thread || '',
        generation: Number(n.generation) || 0,
        dependsOn: asStringArray(n.dependsOn),
    }));

    if (!graph.nodes.length) {
        return seedHeuristicGraph({
            grandEndgameHint: graph.grandEndgame.summary,
            grandEndgameTitle: graph.grandEndgame.title,
            sources: graph.loreSources,
            conflicts: graph.grandEndgame.conflicts,
            secrets: graph.grandEndgame.secrets,
            npcs: [],
            factions: [],
            artifacts: [],
            taboos: [],
        }, complexity, identity);
    }

    mergeEntities(graph.entities, raw.entities);
    graph.worldStatus = raw.worldStatus || graph.worldStatus;
    graph.injectionText = raw.injectionText || buildInjectionText(graph, {
        userAction: '故事刚开始',
        oldNodeTitle: '（尚无失效节点）',
        newNode: graph.nodes.find((n) => n.status === NODE_STATUS.ACTIVE) || graph.nodes[0],
    });
    return graph;
}

function asStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((v) => String(v)).filter(Boolean);
}
