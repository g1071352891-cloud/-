import { NODE_STATUS, PLOT_COMPLEXITY_LABELS } from './constants.js';
import { getSettings } from './settings.js';
import { getChatBundle } from './chat-store.js';

const ROOT_ID = 'uai-dm-root';

/** @type {(action: string) => void} */
let actionHandler = () => {};

export function setUiActionHandler(fn) {
    actionHandler = fn;
}

export function ensureUi() {
    if (document.getElementById(ROOT_ID)) return;
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
        <button type="button" id="uai-dm-fab" class="uai-dm-fab" title="Universal AI DM" aria-label="打开主线图谱">
            <span class="uai-dm-fab-glyph" aria-hidden="true">
                <svg viewBox="0 0 32 32" width="22" height="22">
                    <circle cx="16" cy="7" r="3.2" fill="currentColor"/>
                    <circle cx="7" cy="22" r="2.6" fill="currentColor" opacity=".85"/>
                    <circle cx="25" cy="22" r="2.6" fill="currentColor" opacity=".85"/>
                    <path d="M16 10.4 L8.4 20.2 M16 10.4 L23.6 20.2 M9.6 22 H22.4" fill="none" stroke="currentColor" stroke-width="1.6"/>
                </svg>
            </span>
        </button>
        <aside id="uai-dm-panel" class="uai-dm-panel" hidden>
            <header class="uai-dm-panel-head">
                <div>
                    <p class="uai-dm-kicker">Universal AI DM</p>
                    <h2>主线图谱</h2>
                </div>
                <button type="button" class="uai-dm-icon-btn" data-action="close" title="关闭" aria-label="关闭面板">✕</button>
            </header>
            <nav class="uai-dm-tabs" aria-label="面板分区">
                <button type="button" class="uai-dm-tab is-active" data-tab="plot">主线图谱</button>
                <button type="button" class="uai-dm-tab" data-tab="api">导演 API</button>
            </nav>
            <div class="uai-dm-tab-panels">
            <div id="uai-dm-view-plot" class="uai-dm-view is-active" data-view="plot">
            <div class="uai-dm-toolbar">
                <button type="button" class="uai-dm-btn" data-action="evaluate">立即推演</button>
                <button type="button" class="uai-dm-btn" data-action="rebuild">重建图谱</button>
                <button type="button" class="uai-dm-btn uai-dm-btn-warn" data-action="review">剧情一致性审查</button>
            </div>
            <div id="uai-dm-statusline" class="uai-dm-statusline">待命</div>
            <section id="uai-dm-endgame" class="uai-dm-endgame"></section>
            <section class="uai-dm-section">
                <h3>动态路线节点</h3>
                <div id="uai-dm-nodes" class="uai-dm-nodes"></div>
            </section>
            <section class="uai-dm-section">
                <h3>关键要素</h3>
                <div id="uai-dm-entities" class="uai-dm-entities"></div>
            </section>
            <section class="uai-dm-section">
                <h3>预兆与局势追踪</h3>
                <p id="uai-dm-world" class="uai-dm-world"></p>
            </section>
            <section class="uai-dm-section">
                <h3>导演日志</h3>
                <ol id="uai-dm-log" class="uai-dm-log"></ol>
            </section>
            </div>
            <form id="uai-dm-api" class="uai-dm-view" data-view="api" autocomplete="off">
                <p class="uai-dm-api-lead">导演推演使用的模型，可与角色回复的酒馆主模型分开。Base URL 填到 <code>/v1</code> 为止，不要带 <code>/chat/completions</code>。</p>
                <label class="uai-dm-field">
                    <span>导演模型</span>
                    <select id="uai-dm-api-mode">
                        <option value="main">复用酒馆主模型</option>
                        <option value="custom">独立 Base URL / Key / Model</option>
                    </select>
                </label>
                <div id="uai-dm-api-custom">
                    <label class="uai-dm-field">
                        <span>Base URL</span>
                        <input id="uai-dm-api-url" type="text" spellcheck="false" placeholder="https://api.openai.com/v1" />
                    </label>
                    <label class="uai-dm-field">
                        <span>API Key</span>
                        <input id="uai-dm-api-key" type="password" autocomplete="off" />
                    </label>
                    <label class="uai-dm-field">
                        <span>已拉取模型</span>
                        <select id="uai-dm-api-model-select">
                            <option value="">— 先点「获取模型」—</option>
                        </select>
                    </label>
                    <label class="uai-dm-field">
                        <span>当前模型（可手动填写）</span>
                        <input id="uai-dm-api-model" type="text" spellcheck="false" placeholder="gpt-4o" />
                    </label>
                </div>
                <div class="uai-dm-api-actions">
                    <button type="button" class="uai-dm-btn" data-api-action="test">测试连接</button>
                    <button type="button" class="uai-dm-btn" data-api-action="fetch">获取模型</button>
                </div>
                <p id="uai-dm-api-status" class="uai-dm-api-status">未测试</p>
            </form>
            </div>
        </aside>
    `;
    document.body.appendChild(root);

    const fab = root.querySelector('#uai-dm-fab');
    const panel = root.querySelector('#uai-dm-panel');

    fab.addEventListener('click', () => {
        const willOpen = panel.hasAttribute('hidden');
        togglePanel(willOpen);
    });

    root.querySelectorAll('[data-tab]').forEach((tab) => {
        tab.addEventListener('click', () => switchTab(tab.getAttribute('data-tab')));
    });

    root.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        if (action === 'close') {
            togglePanel(false);
            return;
        }
        actionHandler(action);
    });

    panel.addEventListener('keydown', (ev) => ev.stopPropagation());
    panel.querySelector('#uai-dm-api')?.addEventListener('submit', (ev) => ev.preventDefault());
}

export function switchTab(name) {
    const panel = document.getElementById('uai-dm-panel');
    if (!panel) return;
    panel.querySelectorAll('[data-tab]').forEach((tab) => {
        tab.classList.toggle('is-active', tab.getAttribute('data-tab') === name);
    });
    panel.querySelectorAll('[data-view]').forEach((view) => {
        view.classList.toggle('is-active', view.getAttribute('data-view') === name);
    });
    const title = panel.querySelector('.uai-dm-panel-head h2');
    if (title) title.textContent = name === 'api' ? '导演 API' : '主线图谱';
}

export function togglePanel(open) {
    const panel = document.getElementById('uai-dm-panel');
    const fab = document.getElementById('uai-dm-fab');
    if (!panel || !fab) return;
    if (open) {
        panel.removeAttribute('hidden');
        panel.classList.add('is-open');
        fab.setAttribute('aria-expanded', 'true');
        fab.classList.add('is-open');
    } else {
        panel.classList.remove('is-open');
        panel.setAttribute('hidden', '');
        fab.setAttribute('aria-expanded', 'false');
        fab.classList.remove('is-open');
    }
}

export function setStatusLine(text, kind = '') {
    const el = document.getElementById('uai-dm-statusline');
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind;
}

/**
 * @param {import('./graph.js').MainPlotGraph|null} graph
 * @param {{ busy?: boolean, note?: string }} [state]
 */
export function renderGraph(graph, state = {}) {
    ensureUi();
    const settings = getSettings();
    if (state.busy) setStatusLine(state.note || '导演正在静默推演…', 'busy');
    else if (!settings.enabled) setStatusLine('动态 DM 已关闭', 'off');
    else if (!graph) setStatusLine('等待角色卡 / 世界书…');
    else setStatusLine(state.note || `${PLOT_COMPLEXITY_LABELS[graph.complexity] || graph.complexity} · 节点 ${graph.nodes.length}`, graph.lastReroute ? 'live' : '');

    renderEndgame(graph);
    renderNodes(graph);
    renderEntities(graph);
    renderWorld(graph);
    renderLogs();
}

function renderEndgame(graph) {
    const el = document.getElementById('uai-dm-endgame');
    if (!el) return;
    if (!graph) {
        el.innerHTML = `<article class="uai-dm-endgame-card is-empty"><h3>终极主线尚未锁定</h3><p>打开一场带有世界书的聊天后，导演会抽取最高冲突并在此钉死终局。</p></article>`;
        return;
    }
    const g = graph.grandEndgame;
    el.innerHTML = `
        <article class="uai-dm-endgame-card ${g.locked ? 'is-locked' : ''}">
            <div class="uai-dm-endgame-label">终极主线 / 世界危机</div>
            <h3>${escapeHtml(g.title)}</h3>
            <p>${escapeHtml(g.summary)}</p>
            <footer>
                <span>${g.locked ? '已锁定，不因跑题消失' : '未锁定'}</span>
                <span>${escapeHtml((g.conflicts || []).slice(0, 2).join(' · '))}</span>
            </footer>
        </article>
    `;
}

function renderNodes(graph) {
    const el = document.getElementById('uai-dm-nodes');
    if (!el) return;
    if (!graph?.nodes?.length) {
        el.innerHTML = `<p class="uai-dm-muted">尚无里程碑。点击「重建图谱」从世界书生成。</p>`;
        return;
    }

    const lastRerouteAt = graph.lastReroute?.at || 0;
    const html = graph.nodes.map((node, index) => {
        const rerouted = node.status === NODE_STATUS.REROUTED;
        const isNew = !rerouted && node.generation > 0 && lastRerouteAt && (Date.now() - lastRerouteAt < 120000);
        const cls = [
            'uai-dm-node',
            rerouted ? 'dm-rerouted' : '',
            isNew ? 'dm-new' : '',
            `is-${node.status}`,
        ].filter(Boolean).join(' ');
        const clues = (node.clues || []).slice(0, 3).map((c) => `<li>${escapeHtml(c)}</li>`).join('');
        return `
            <article class="${cls}" data-node-id="${escapeAttr(node.id)}">
                ${index < graph.nodes.length - 1 ? '<span class="uai-dm-thread" aria-hidden="true"></span>' : ''}
                <header>
                    <span class="uai-dm-node-id">${escapeHtml(node.id)}</span>
                    <span class="uai-dm-node-status">${labelStatus(node.status)}</span>
                </header>
                <h4 class="uai-dm-node-title">${escapeHtml(node.title)}</h4>
                <p>${escapeHtml(node.description)}</p>
                ${clues ? `<ul class="uai-dm-clues">${clues}</ul>` : ''}
                ${node.reroutedFrom ? `<div class="uai-dm-from">由 ${escapeHtml(node.reroutedFrom)} 重路由</div>` : ''}
            </article>
        `;
    }).join('');
    el.innerHTML = html;
}

function renderEntities(graph) {
    const el = document.getElementById('uai-dm-entities');
    if (!el) return;
    if (!graph) {
        el.innerHTML = '';
        return;
    }
    const buckets = [
        ['NPC', graph.entities?.npcs],
        ['阵营', graph.entities?.factions],
        ['绝密物品', graph.entities?.artifacts],
        ['规则忌讳', graph.entities?.taboos],
    ];
    el.innerHTML = buckets.map(([label, list]) => {
        const items = (list || []).slice(0, 6);
        if (!items.length) return '';
        return `<div class="uai-dm-entity-col"><div class="uai-dm-entity-label">${label}</div>${items.map((e) => `<span class="uai-dm-chip" title="${escapeAttr(e.notes || '')}">${escapeHtml(e.name)}</span>`).join('')}</div>`;
    }).join('') || `<p class="uai-dm-muted">未绑定到世界书实体。</p>`;
}

function renderWorld(graph) {
    const el = document.getElementById('uai-dm-world');
    if (!el) return;
    el.textContent = graph?.worldStatus || '尚未形成可追踪的暗流。';
}

function renderLogs() {
    const el = document.getElementById('uai-dm-log');
    if (!el) return;
    const logs = getChatBundle().logs || [];
    const slice = logs.slice(-12).reverse();
    el.innerHTML = slice.map((row) => `<li><time>${formatTime(row.at)}</time><span>${escapeHtml(row.line)}</span></li>`).join('')
        || '<li class="uai-dm-muted">日志为空。</li>';
}

function labelStatus(status) {
    return {
        pending: '待触发',
        active: '推进中',
        completed: '已完成',
        rerouted: '已失效',
    }[status] || status;
}

function formatTime(ts) {
    try {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, '&#39;');
}
