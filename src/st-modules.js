/**
 * Resolve SillyTavern internal modules without hard-failing on path differences.
 * Third-party extensions live at /scripts/extensions/third-party/<name>/.
 */

/** @type {Record<string, Promise<any>>} */
const cache = {};

/**
 * @param {string} fileName e.g. 'world-info.js'
 * @returns {Promise<any|null>}
 */
export async function importScriptsModule(fileName) {
    if (!cache[fileName]) {
        const here = import.meta.url;
        const candidates = [
            `/scripts/${fileName}`,
            new URL(`../../../../${fileName}`, here).href,
            new URL(`../../../${fileName}`, here).href,
        ];
        cache[fileName] = (async () => {
            for (const href of candidates) {
                try {
                    return await import(/* webpackIgnore: true */ href);
                } catch {
                    // try next
                }
            }
            console.warn(`[Universal-AI-DM] Failed to import ${fileName}`);
            return null;
        })();
    }
    return cache[fileName];
}

export async function getWorldInfoModule() {
    return importScriptsModule('world-info.js');
}
