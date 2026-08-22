import { API_MODE } from './constants.js';
import { getSettings, updateSettings } from './settings.js';
import { listDirectorModels, testDirectorConnection } from './director-api.js';

let syncing = false;

export function fillSettingsForms() {
    const settings = getSettings();
    syncing = true;
    setValue('#uai_dm_enabled, #uai-dm-opt-enabled', settings.enabled, 'checked');
    setValue('#uai_dm_inject, #uai-dm-opt-inject', settings.injectEnabled, 'checked');
    setValue('#uai_dm_sync_lore, #uai-dm-opt-sync', settings.syncLorebook, 'checked');
    setValue('#uai_dm_complexity, #uai-dm-opt-complexity', settings.plotComplexity);
    setValue('#uai_dm_sensitivity, #uai-dm-opt-sensitivity', settings.rerouteSensitivity);
    setText('#uai_dm_sensitivity_val, #uai-dm-opt-sensitivity-val', String(settings.rerouteSensitivity));
    setValue('#uai_dm_every_n, #uai-dm-opt-every-n', settings.evaluateEveryN);
    setValue('#uai_dm_api_mode, #uai-dm-api-mode', settings.apiMode);
    setValue('#uai_dm_api_url, #uai-dm-api-url', settings.apiBaseUrl);
    setValue('#uai_dm_api_key, #uai-dm-api-key', settings.apiKey);
    setValue('#uai_dm_api_model, #uai-dm-api-model', settings.apiModel);
    fillModelSelects(settings.apiModelList || [], settings.apiModel);
    toggleCustomApiFields();
    syncing = false;
}

export function bindSettingsForms() {
    const roots = [document.getElementById('uai_dm_settings'), document.getElementById('uai-dm-api')].filter(Boolean);
    for (const root of roots) {
        root.addEventListener('input', onFormInput);
        root.addEventListener('change', onFormInput);
        root.addEventListener('click', onFormClick);
    }
}

function onFormInput(ev) {
    if (syncing) return;
    const el = ev.target;
    if (!(el instanceof HTMLElement)) return;
    const id = el.id || '';

    if (id.includes('enabled') && 'checked' in el) {
        updateSettings({ enabled: Boolean(el.checked) });
        setValue('#uai_dm_enabled, #uai-dm-opt-enabled', el.checked, 'checked', el);
    } else if (id.includes('inject') && 'checked' in el) {
        updateSettings({ injectEnabled: Boolean(el.checked) });
        setValue('#uai_dm_inject, #uai-dm-opt-inject', el.checked, 'checked', el);
    } else if ((id.includes('sync_lore') || id.includes('opt-sync')) && 'checked' in el) {
        updateSettings({ syncLorebook: Boolean(el.checked) });
        setValue('#uai_dm_sync_lore, #uai-dm-opt-sync', el.checked, 'checked', el);
    } else if (id.includes('complexity')) {
        updateSettings({ plotComplexity: el.value });
        setValue('#uai_dm_complexity, #uai-dm-opt-complexity', el.value, 'value', el);
    } else if (id.includes('sensitivity') && el.type === 'range') {
        const value = Number(el.value);
        setText('#uai_dm_sensitivity_val, #uai-dm-opt-sensitivity-val', String(value));
        updateSettings({ rerouteSensitivity: value });
        setValue('#uai_dm_sensitivity, #uai-dm-opt-sensitivity', value, 'value', el);
    } else if (id.includes('every_n') || id.includes('every-n')) {
        updateSettings({ evaluateEveryN: Math.max(1, Math.min(20, Number(el.value) || 3)) });
        setValue('#uai_dm_every_n, #uai-dm-opt-every-n', el.value, 'value', el);
    } else if (id.endsWith('api_mode') || id.endsWith('api-mode')) {
        updateSettings({ apiMode: el.value });
        setValue('#uai_dm_api_mode, #uai-dm-api-mode', el.value, 'value', el);
        toggleCustomApiFields();
    } else if (id.endsWith('api_url') || id.endsWith('api-url')) {
        updateSettings({ apiBaseUrl: el.value.trim() });
        setValue('#uai_dm_api_url, #uai-dm-api-url', el.value, 'value', el);
    } else if (id.endsWith('api_key') || id.endsWith('api-key')) {
        updateSettings({ apiKey: el.value });
        setValue('#uai_dm_api_key, #uai-dm-api-key', el.value, 'value', el);
    } else if (id.endsWith('api_model') || id.endsWith('api-model')) {
        updateSettings({ apiModel: el.value.trim() });
        setValue('#uai_dm_api_model, #uai-dm-api-model', el.value, 'value', el);
    } else if (id.endsWith('model-select') || id.endsWith('model_select')) {
        if (!el.value) return;
        updateSettings({ apiModel: el.value });
        setValue('#uai_dm_api_model, #uai-dm-api-model', el.value);
        setValue('#uai-dm-api-model-select, #uai_dm_api_model_select', el.value, 'value', el);
    }
}

function setValue(selector, value, mode = 'value', except = null) {
    document.querySelectorAll(selector).forEach((node) => {
        if (node === except) return;
        if (mode === 'checked') node.checked = Boolean(value);
        else node.value = value ?? '';
    });
}

async function onFormClick(ev) {
    const btn = ev.target.closest('[data-api-action]');
    if (!btn) return;
    ev.preventDefault();
    const action = btn.getAttribute('data-api-action');
    if (action === 'test') await runTest(btn);
    if (action === 'fetch') await runFetch(btn);
}

function toggleCustomApiFields() {
    const custom = getSettings().apiMode === API_MODE.CUSTOM;
    for (const id of ['uai_dm_custom_api', 'uai-dm-api-custom']) {
        const block = document.getElementById(id);
        if (block) block.hidden = !custom;
    }
}

function fillModelSelects(models, current) {
    const ordered = [...new Set([current, ...(models || [])].filter(Boolean))];
    const html = ['<option value="">— 选择已拉取的模型 —</option>']
        .concat(ordered.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`))
        .join('');
    for (const id of ['uai-dm-api-model-select', 'uai_dm_api_model_select']) {
        const sel = document.getElementById(id);
        if (!sel) continue;
        sel.innerHTML = html;
        if (current) sel.value = current;
    }
}

function setApiStatus(text, kind = '') {
    for (const id of ['uai-dm-api-status', 'uai_dm_api_status']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.textContent = text;
        el.dataset.kind = kind;
    }
}

async function runTest(btn) {
    setBusy(btn, true);
    setApiStatus('正在测试连接…', 'busy');
    try {
        const result = await testDirectorConnection(getSettings());
        setApiStatus(result.message, result.ok ? 'ok' : 'err');
        if (result.ok && Array.isArray(result.models) && result.models.length) {
            updateSettings({ apiModelList: result.models });
            fillModelSelects(result.models, getSettings().apiModel);
        }
        toast(result.ok ? result.message : result.message, result.ok ? 'success' : 'error');
    } catch (err) {
        const msg = String(err.message || err);
        setApiStatus(msg, 'err');
        toast(msg, 'error');
    } finally {
        setBusy(btn, false);
    }
}

async function runFetch(btn) {
    const settings = getSettings();
    if (settings.apiMode !== API_MODE.CUSTOM) {
        setApiStatus('复用酒馆主模型时，请在酒馆的 API 连接面板选择模型。', 'off');
        return;
    }
    setBusy(btn, true);
    setApiStatus('正在获取模型列表…', 'busy');
    try {
        const listed = await listDirectorModels(settings);
        updateSettings({ apiModelList: listed.models });
        const current = settings.apiModel && listed.models.includes(settings.apiModel)
            ? settings.apiModel
            : (listed.models[0] || settings.apiModel);
        if (current && current !== settings.apiModel) {
            updateSettings({ apiModel: current });
        }
        fillSettingsForms();
        const via = listed.via === 'proxy' ? '经酒馆代理' : '直连';
        const msg = listed.models.length
            ? `已获取 ${listed.models.length} 个模型（${via}，${listed.ms}ms）`
            : `连接成功但列表为空（${via}）。请手动填写模型名。`;
        setApiStatus(msg, listed.models.length ? 'ok' : 'off');
        toast(msg, listed.models.length ? 'success' : 'info');
    } catch (err) {
        const msg = String(err.message || err);
        setApiStatus(msg, 'err');
        toast(msg, 'error');
    } finally {
        setBusy(btn, false);
    }
}

function setBusy(btn, busy) {
    const buttons = document.querySelectorAll('[data-api-action]');
    buttons.forEach((b) => { b.disabled = busy; });
    if (btn) btn.classList.toggle('is-busy', busy);
}

function toast(message, kind) {
    if (typeof toastr === 'undefined') return;
    if (kind === 'success') toastr.success(message, '导演 API');
    else if (kind === 'error') toastr.error(message, '导演 API');
    else toastr.info(message, '导演 API');
}

function setText(selector, text) {
    document.querySelectorAll(selector).forEach((el) => { el.textContent = text; });
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
