import { NODE_STATUS } from './constants.js';
import { getSettings } from './settings.js';
import {
    applyReroute,
    buildInjectionText,
    normalizeGraphFromLlm,
    seedHeuristicGraph,
} from './graph.js';
import { parseLoreDeep } from './lore-parser.js';
import { requestInitialGraph, requestReroute } from './director-prompts.js';
import {
    appendLog,
    getCharacterName,
    getChatKey,
    getRecentTranscript,
    getVisibleMessageCount,
} from './chat-store.js';

/**
 * Deviation threshold from the 0-100 sensitivity slider.
 * Higher sensitivity → smaller deviation is enough to rewrite the path.
 * @param {number} sensitivity
 */
export function deviationThreshold(sensitivity) {
    const s = clamp(Number(sensitivity) || 0, 0, 100);
    return (100 - s) / 100 * 0.7 + 0.12;
}

/**
 * @param {object} args
 * @param {import('./graph.js').MainPlotGraph|null} args.graph
 * @param {object} [args.lore] already-parsed lore digest
 * @param {boolean} [args.rebuild]
 * @param {boolean} [args.force]
 */
export async function runDirectorCycle({ graph, lore: loreIn, rebuild = false, force = false } = {}) {
    const settings = getSettings();
    const identity = {
        chatKey: getChatKey(),
        characterName: getCharacterName(),
    };

    const lore = loreIn || await parseLoreDeep();
    identity.loreSources = lore.sources;

    let nextGraph = graph;
    const chatChanged = !nextGraph || nextGraph.chatKey !== identity.chatKey;
    if (rebuild || chatChanged || !nextGraph?.nodes?.length) {
        nextGraph = await buildGraph(lore, settings.plotComplexity, identity);
        appendLog(`主线图谱已构建：${nextGraph.grandEndgame.title}`);
    }

    const recentChat = getRecentTranscript(20);
    let rerouted = false;
    let decision = null;

    const canAssess = force || getVisibleMessageCount() >= 2;
    if (canAssess && nextGraph.grandEndgame.locked) {
        try {
            decision = await requestReroute({
                graph: nextGraph,
                lore,
                recentChat: recentChat || '(empty)',
                sensitivity: settings.rerouteSensitivity,
            });
        } catch (err) {
            console.warn('[Universal-AI-DM] reroute LLM failed, using heuristic impact', err);
            decision = heuristicImpact(recentChat, nextGraph, settings.rerouteSensitivity);
        }

        const score = Number(decision?.deviationScore) || 0;
        const threshold = deviationThreshold(settings.rerouteSensitivity);
        const should = (Boolean(decision?.shouldReroute) && score >= threshold * 0.6)
            || score >= threshold;

        if (decision) {
            if (Array.isArray(decision.completedNodeIds) && decision.completedNodeIds.length) {
                for (const id of decision.completedNodeIds) {
                    const node = nextGraph.nodes.find((n) => n.id === id);
                    if (node && node.status !== NODE_STATUS.REROUTED) node.status = NODE_STATUS.COMPLETED;
                }
            }
            if (decision.worldStatus && !should) {
                nextGraph.worldStatus = decision.worldStatus;
            }
        }

        if (should && decision) {
            const oldTitles = (decision.invalidatedNodeIds || [])
                .map((id) => nextGraph.nodes.find((n) => n.id === id)?.title)
                .filter(Boolean)
                .join(' / ') || '原定推进节点';
            applyReroute(nextGraph, decision);
            const newest = nextGraph.nodes.filter((n) => n.generation && n.generation === Math.max(0, ...nextGraph.nodes.map((n) => n.generation || 0)));
            nextGraph.injectionText = buildInjectionText(nextGraph, {
                userAction: decision.userAction || '一次改写局势的行动',
                oldNodeTitle: oldTitles,
                newNode: newest[0],
            });
            rerouted = true;
            appendLog(`重路由：${decision.userAction || ''} → ${newest.map((n) => n.title).join(' / ')}`);
        } else if (decision?.userAction && nextGraph.injectionText) {
            nextGraph.injectionText = buildInjectionText(nextGraph, {
                userAction: decision.userAction,
                oldNodeTitle: '（当前节点仍有效）',
                newNode: nextGraph.nodes.find((n) => n.status === NODE_STATUS.ACTIVE),
            });
        }
    }

    nextGraph.lastEvaluatedMessageCount = getVisibleMessageCount();
    nextGraph.updatedAt = Date.now();
    nextGraph.loreSources = lore.sources;

    return { graph: nextGraph, lore, rerouted, decision };
}

async function buildGraph(lore, complexity, identity) {
    const recentChat = getRecentTranscript(8);
    try {
        const raw = await requestInitialGraph({ lore, complexity, identity, recentChat });
        const graph = normalizeGraphFromLlm(raw, identity, complexity);
        graph.grandEndgame.locked = true;
        return graph;
    } catch (err) {
        console.warn('[Universal-AI-DM] initial graph LLM failed, seeding heuristic graph', err);
        return seedHeuristicGraph(lore, complexity, identity);
    }
}

function heuristicImpact(recentChat, graph, sensitivity) {
    const text = String(recentChat || '');
    const kill = /(杀|死了|刺死|枪杀|毒死|处决|murder|kill|stabbed|executed)/i.test(text);
    const joinEnemy = /(加入|投靠|效忠).{0,8}(敌|敌对|反派|join).{0,12}(faction|阵营)?/i.test(text);
    const slice = /(回家|买菜|约会|睡觉|日常|逛街|做饭)/i.test(text) && text.length > 80;
    const wreck = /(放弃|不管了|炸掉|烧毁|毁掉计划)/i.test(text);
    let score = 0;
    const bits = [];
    if (kill) { score += 0.55; bits.push('关键人物可能已被移除'); }
    if (joinEnemy) { score += 0.4; bits.push('玩家改换阵营'); }
    if (slice) { score += 0.28; bits.push('剧情转入日常'); }
    if (wreck) { score += 0.4; bits.push('原计划被破坏'); }
    score = Math.min(1, score * (0.7 + (Number(sensitivity) || 50) / 200));
    const active = graph.nodes.find((n) => n.status === NODE_STATUS.ACTIVE);
    return {
        shouldReroute: score >= deviationThreshold(sensitivity),
        deviationScore: score,
        userAction: bits.join('；') || '玩家行动尚不足以改写主线',
        invalidatedNodeIds: score >= 0.45 && active ? [active.id] : [],
        completedNodeIds: [],
        newNodes: score >= 0.45 && active ? [{
            title: `${active.title}的余波`,
            description: `原节点因玩家行动失效。世界改用另一条裂缝把玩家重新拽向「${graph.grandEndgame.title}」。`,
            status: NODE_STATUS.ACTIVE,
            clues: ['世界不会当这件事没发生', '终局改换了接近玩家的方式'],
            reroutedFrom: active.id,
            thread: active.thread || '重路由',
        }] : [],
        worldReaction: bits.join('；'),
        worldStatus: bits.length
            ? `因为 ${bits.join('，')}，各阵营开始重新计算玩家的位置。终极主线并未消失，只是改换了接近的角度。`
            : graph.worldStatus,
    };
}

function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
}
