/**
 * Universal-AI-DM
 * Multi-tier Main Plot Graph + Dynamic Re-Routing Engine for SillyTavern.
 */

import { LOG_PREFIX, MODULE_NAME, PLOT_COMPLEXITY } from './src/constants.js';
import { getSettings, saveSettings, updateSettings } from './src/settings.js';
import { bindPromptHooks, clearDirectorInjection, setDirectorInjection } from './src/injector.js';
import { parseLoreDeep } from './src/lore-parser.js';
import { runDirectorCycle } from './src/engine.js';
import { syncDynamicLore } from './src/lore-sync.js';
import { runConsistencyReview } from './src/reviewer.js';
import { getChatBundle, persistChatBundle, getCharacterName, getChatKey } from './src/chat-store.js';
import { ensureUi, renderGraph, setStatusLine, setUiActionHandler } from './src/ui.js';

/** In-memory plot graph for the active chat. */
let mainPlotGraph = null;

/** @type {Promise<any>|null} */
let evalLock = null;

/**
 * Silent / manual director cycle.
 *
 * 1. Lorebook Deep Parser
 * 2. User Impact Assessment (last 10 turns)
 * 3. Dynamic Re-Routing Calculation (never restore invalidated nodes)
 * 4. Seamless prompt injection (Depth 0 / system)
 *
 * @param {{ force?: boolean, rebuild?: boolean, silent?: boolean }} [options]
 */
export async function evaluateAndReRoutePlot(options = {}) {
    const { force = false, rebuild = false, silent = false } = options;
    const settings = getSettings();

    if (!settings.enabled && !force) {
        return mainPlotGraph;
    }

    const ctx = SillyTavern.getContext();
    if (!ctx.getCurrentChatId?.() && ctx.characterId == null && !ctx.groupId) {
        if (!silent && typeof toastr !== 'undefined') toastr.info('请先打开一场聊天。', 'Universal AI DM');
        return null;
    }

    if (evalLock) return evalLock;

    evalLock = (async () => {
        renderGraph(mainPlotGraph, { busy: true, note: rebuild ? '正在从世界书重建终极主线…' : '正在评估玩家行动并计算重路由…' });
        try {
            // --- 1. 深度世界书解析 (Lorebook Deep Parser) ---
            const lore = await parseLoreDeep();

            // --- 2–3. 玩家影响评估 + 动态重路由 ---
            // 若玩家摧毁了【节点A】：划掉它，生成【节点A'】，终局不消失。
            const result = await runDirectorCycle({
                graph: rebuild ? null : mainPlotGraph,
                lore,
                rebuild,
                force: force || !silent,
            });

            mainPlotGraph = result.graph;

            // --- 4. 无缝提示词注入 ---
            setDirectorInjection(mainPlotGraph.injectionText || '');

            if (result.rerouted) {
                try {
                    await syncDynamicLore(mainPlotGraph);
                } catch (err) {
                    console.warn(LOG_PREFIX, 'Lorebook sync failed', err);
                }
            } else if (rebuild || !Object.keys(mainPlotGraph.loreEntryUids || {}).length) {
                try {
                    await syncDynamicLore(mainPlotGraph);
                } catch (err) {
                    console.warn(LOG_PREFIX, 'Lorebook initial sync failed', err);
                }
            }

            await persistChatBundle({
                graph: mainPlotGraph,
                lastEvalAt: Date.now(),
            });

            renderGraph(mainPlotGraph, {
                note: result.rerouted
                    ? '已重路由：旧节点失效，新路径指向同一终局'
                    : '终极主线仍锁定，当前路径有效',
            });

            if (result.rerouted && !silent && typeof toastr !== 'undefined') {
                toastr.info('主线已按玩家行动改写解法节点。', 'Universal AI DM');
            }

            return mainPlotGraph;
        } catch (err) {
            console.error(LOG_PREFIX, 'evaluateAndReRoutePlot failed', err);
            setStatusLine(`推演失败：${err.message || err}`, 'off');
            if (!silent && typeof toastr !== 'undefined') {
                toastr.error(String(err.message || err), 'Universal AI DM');
            }
            return mainPlotGraph;
        } finally {
            evalLock = null;
        }
    })();

    return evalLock;
}

globalThis.evaluateAndReRoutePlot = evaluateAndReRoutePlot;

function loadGraphFromChat() {
    const bundle = getChatBundle();
    mainPlotGraph = bundle.graph || null;
    if (mainPlotGraph) setDirectorInjection(mainPlotGraph.injectionText || '');
    else clearDirectorInjection();
    renderGraph(mainPlotGraph);
}

function shouldAutoEvaluate() {
    const settings = getSettings();
    if (!settings.enabled) return false;
    const n = Math.max(1, Number(settings.evaluateEveryN) || 3);
    const chat = SillyTavern.getContext().chat || [];
    const userTurns = chat.filter((m) => m && m.is_user).length;
    if (!mainPlotGraph?.nodes?.length) return true;
    return userTurns > 0 && userTurns % n === 0;
}

/**
 * Awaited by SillyTavern before prompt construction so re-routing lands in the same turn.
 */
globalThis.UniversalAiDmInterceptor = async function UniversalAiDmInterceptor(_chat, _contextSize, _abort, type) {
    if (type === 'quiet' || type === 'impersonate' || type === 'swipe' || type === 'regenerate') return;
    const settings = getSettings();
    if (!settings.enabled) return;
    if (!shouldAutoEvaluate()) {
        if (mainPlotGraph?.injectionText) setDirectorInjection(mainPlotGraph.injectionText);
        return;
    }
    await evaluateAndReRoutePlot({ silent: true });
};

function bindAppEvents() {
    const { eventSource, event_types: types } = SillyTavern.getContext();
    if (!eventSource?.on) return;

    bindPromptHooks();

    const onChatChanged = () => {
        loadGraphFromChat();
    };
    eventSource.on(types?.CHAT_CHANGED || 'chat_id_changed', onChatChanged);

    eventSource.on(types?.WORLDINFO_UPDATED || 'worldinfo_updated', () => {
        if (!getSettings().enabled) return;
        // Lore changed: keep locked endgame, but the next cycle will re-read sources.
    });
}

async function mountSettings() {
    const host = document.getElementById('extensions_settings') || document.getElementById('extensions_settings2');
    if (!host || document.getElementById('uai_dm_settings')) return;

    const html = await fetch(new URL('./settings.html', import.meta.url)).then((r) => r.text());
    host.insertAdjacentHTML('beforeend', html);

    const settings = getSettings();
    const $ = globalThis.jQuery || globalThis.$;
    if (!$) return;

    const $root = $('#uai_dm_settings');
    $root.find('#uai_dm_enabled').prop('checked', settings.enabled);
    $root.find('#uai_dm_inject').prop('checked', settings.injectEnabled);
    $root.find('#uai_dm_sync_lore').prop('checked', settings.syncLorebook);
    $root.find('#uai_dm_complexity').val(settings.plotComplexity || PLOT_COMPLEXITY.WEB);
    $root.find('#uai_dm_sensitivity').val(settings.rerouteSensitivity);
    $root.find('#uai_dm_sensitivity_val').text(settings.rerouteSensitivity);
    $root.find('#uai_dm_every_n').val(settings.evaluateEveryN);
    $root.find('#uai_dm_api_mode').val(settings.apiMode);
    $root.find('#uai_dm_api_url').val(settings.apiBaseUrl);
    $root.find('#uai_dm_api_key').val(settings.apiKey);
    $root.find('#uai_dm_api_model').val(settings.apiModel);
    toggleCustomApiFields();

    $root.find('#uai_dm_enabled').on('input', function () {
        updateSettings({ enabled: Boolean(this.checked) });
        if (!this.checked) clearDirectorInjection();
        else if (mainPlotGraph) setDirectorInjection(mainPlotGraph.injectionText || '');
        renderGraph(mainPlotGraph);
    });
    $root.find('#uai_dm_inject').on('input', function () {
        updateSettings({ injectEnabled: Boolean(this.checked) });
        if (mainPlotGraph) setDirectorInjection(mainPlotGraph.injectionText || '');
    });
    $root.find('#uai_dm_sync_lore').on('input', function () {
        updateSettings({ syncLorebook: Boolean(this.checked) });
    });
    $root.find('#uai_dm_complexity').on('change', function () {
        updateSettings({ plotComplexity: this.value });
    });
    $root.find('#uai_dm_sensitivity').on('input', function () {
        const value = Number(this.value);
        $root.find('#uai_dm_sensitivity_val').text(value);
        updateSettings({ rerouteSensitivity: value });
    });
    $root.find('#uai_dm_every_n').on('input', function () {
        updateSettings({ evaluateEveryN: Math.max(1, Math.min(20, Number(this.value) || 3)) });
    });
    $root.find('#uai_dm_api_mode').on('change', function () {
        updateSettings({ apiMode: this.value });
        toggleCustomApiFields();
    });
    $root.find('#uai_dm_api_url').on('input', function () {
        updateSettings({ apiBaseUrl: this.value.trim() });
    });
    $root.find('#uai_dm_api_key').on('input', function () {
        updateSettings({ apiKey: this.value });
    });
    $root.find('#uai_dm_api_model').on('input', function () {
        updateSettings({ apiModel: this.value.trim() });
    });

    saveSettings();
}

function toggleCustomApiFields() {
    const custom = getSettings().apiMode === 'custom';
    const block = document.getElementById('uai_dm_custom_api');
    if (block) block.hidden = !custom;
}

function registerSlashCommands() {
    const ctx = SillyTavern.getContext();
    if (!ctx.SlashCommandParser?.addCommandObject || !ctx.SlashCommand?.fromProps) return;

    const { SlashCommand, SlashCommandParser } = ctx;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'uadm',
        callback: async () => {
            await evaluateAndReRoutePlot({ force: true });
            return 'Universal AI DM: evaluated.';
        },
        aliases: ['uadm-eval'],
        helpString: '立即运行 Universal AI DM 的主线评估与重路由。',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'uadm-rebuild',
        callback: async () => {
            await evaluateAndReRoutePlot({ force: true, rebuild: true });
            return 'Universal AI DM: graph rebuilt.';
        },
        helpString: '从世界书重建终极主线图谱。',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'uadm-review',
        callback: async () => {
            await runConsistencyReview(mainPlotGraph);
            renderGraph(mainPlotGraph);
            return 'Universal AI DM: consistency review done.';
        },
        helpString: '审查近 5 轮对话是否违背世界书核心设定。',
    }));
}

function bindPanelActions() {
    setUiActionHandler(async (action) => {
        if (action === 'evaluate') await evaluateAndReRoutePlot({ force: true });
        if (action === 'rebuild') await evaluateAndReRoutePlot({ force: true, rebuild: true });
        if (action === 'review') {
            setStatusLine('正在审查近 5 轮是否吃书…', 'busy');
            try {
                const result = await runConsistencyReview(mainPlotGraph);
                await persistChatBundle({});
                renderGraph(mainPlotGraph, {
                    note: result.hasViolations
                        ? `发现 ${result.violations.length} 处可能吃书，见日志`
                        : '一致性审查通过',
                });
            } catch (err) {
                setStatusLine(`审查失败：${err.message || err}`, 'off');
                if (typeof toastr !== 'undefined') toastr.error(String(err.message || err), '剧情一致性审查');
            }
        }
    });
}

async function init() {
    getSettings();
    ensureUi();
    bindPanelActions();
    await mountSettings();
    bindAppEvents();
    registerSlashCommands();
    loadGraphFromChat();
    globalThis.UniversalAiDm = {
        evaluateAndReRoutePlot,
        getGraph: () => mainPlotGraph,
        parseLoreDeep,
    };
    console.log(LOG_PREFIX, `ready (${MODULE_NAME})`, getCharacterName(), getChatKey());
}

jQuery(async () => {
    try {
        await init();
    } catch (err) {
        console.error(LOG_PREFIX, 'init failed', err);
    }
});

export { mainPlotGraph };
export { MODULE_NAME };
