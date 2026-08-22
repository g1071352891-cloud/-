import { requestConsistencyReview } from './director-prompts.js';
import { parseLoreDeep } from './lore-parser.js';
import { appendLog, getRecentTranscript } from './chat-store.js';

/**
 * Review the last 5 turns against lorebook canon.
 * @param {import('./graph.js').MainPlotGraph|null} graph
 */
export async function runConsistencyReview(graph) {
    const lore = await parseLoreDeep();
    const recentChat = getRecentTranscript(10);
    const lastFive = recentChat.split('\n\n').slice(-10).join('\n\n');
    const result = await requestConsistencyReview({
        lore,
        recentChat: lastFive || '(no chat yet)',
        graph,
    });

    const violations = Array.isArray(result.violations) ? result.violations.filter((v) => v && (v.quote || v.against)) : [];
    const hasViolations = Boolean(result.hasViolations) && violations.length > 0;

    if (hasViolations) {
        const first = violations[0];
        const toast = first.against || first.quote || '近 5 轮对话可能违背了世界书核心设定';
        if (typeof toastr !== 'undefined') {
            toastr.warning(toast, '剧情一致性审查', { timeOut: 8000 });
        }
        for (const v of violations) {
            appendLog(`吃书：${v.against || ''}｜建议：${v.suggestion || ''}`);
        }
    } else {
        appendLog('一致性审查：近 5 轮未发现明确吃书。');
        if (typeof toastr !== 'undefined') {
            toastr.success(result.summary || '近 5 轮未发现明确的世界书违背。', '剧情一致性审查');
        }
    }

    return { ...result, hasViolations, violations };
}
