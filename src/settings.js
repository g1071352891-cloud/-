import { DEFAULT_SETTINGS, MODULE_NAME } from './constants.js';

/**
 * @returns {typeof DEFAULT_SETTINGS & Record<string, unknown>}
 */
export function getSettings() {
    const { extensionSettings } = getCtx();
    if (!extensionSettings[MODULE_NAME] || typeof extensionSettings[MODULE_NAME] !== 'object') {
        extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }

    const settings = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = DEFAULT_SETTINGS[key];
        }
    }
    return settings;
}

export function saveSettings() {
    const { saveSettingsDebounced } = getCtx();
    saveSettingsDebounced();
}

/**
 * @param {Partial<typeof DEFAULT_SETTINGS>} patch
 */
export function updateSettings(patch) {
    const settings = getSettings();
    Object.assign(settings, patch);
    saveSettings();
    return settings;
}

function getCtx() {
    return SillyTavern.getContext();
}
