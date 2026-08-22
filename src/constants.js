/** @enum {string} */
export const MODULE_NAME = 'universal_ai_dm';

export const DISPLAY_NAME = 'Universal AI DM';

export const EXTENSION_PROMPT_KEY = 'UNIVERSAL_AI_DM';

export const CHAT_META_KEY = 'universal_ai_dm';

export const DYNAMIC_LORE_TAG = '[DM_Dynamic_Node]';

export const DYNAMIC_LORE_GROUP = 'DM_Dynamic_Node';

export const INJECTION_MARKER = '【DM 导演重路由指令】';

/** ST extension_prompt_types.IN_CHAT */
export const PROMPT_POSITION_IN_CHAT = 1;

/** ST extension_prompt_roles.SYSTEM */
export const PROMPT_ROLE_SYSTEM = 0;

export const PLOT_COMPLEXITY = Object.freeze({
    LINEAR: 'linear',
    DUAL: 'dual',
    WEB: 'web',
});

export const PLOT_COMPLEXITY_LABELS = Object.freeze({
    linear: '单线线性',
    dual: '双线交织',
    web: '网状多阵营阴谋',
});

export const NODE_STATUS = Object.freeze({
    PENDING: 'pending',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    REROUTED: 'rerouted',
});

export const API_MODE = Object.freeze({
    MAIN: 'main',
    CUSTOM: 'custom',
});

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    apiMode: API_MODE.MAIN,
    apiBaseUrl: '',
    apiKey: '',
    apiModel: '',
    plotComplexity: PLOT_COMPLEXITY.WEB,
    rerouteSensitivity: 55,
    evaluateEveryN: 3,
    injectEnabled: true,
    syncLorebook: true,
});

export const NODE_COUNT_BY_COMPLEXITY = Object.freeze({
    linear: 3,
    dual: 4,
    web: 5,
});

export const LOG_PREFIX = '[Universal-AI-DM]';
