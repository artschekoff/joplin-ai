import { diff_match_patch } from 'diff-match-patch';
import { computeDiffHunks } from './diff-lines';

export interface NoteDiff {
	isIdentical: boolean;
	/** 0.0 = identical, 1.0 = completely different. Based on line-level comparison. */
	changeRatio: number;
	/** Human-readable summary of changes, empty when identical. */
	summary: string;
}

/**
 * Find the nearest Markdown heading (##, ###, etc.) at or before a given line index.
 */
const findNearestHeading = (lines: string[], lineIndex: number): string | null => {
	for (let i = lineIndex; i >= 0; i--) {
		const match = lines[i].match(/^#{1,6}\s+(.+)/);
		if (match) return match[1].trim();
	}
	return null;
};

/**
 * Compute a line-level diff between two note bodies.
 *
 * Uses a simple LCS-based algorithm to identify added, removed, and modified lines.
 * Returns a ratio of changed lines and a human-readable summary.
 */
export const computeNoteDiff = (oldBody: string, newBody: string): NoteDiff => {
	if (oldBody === newBody) {
		return { isIdentical: true, changeRatio: 0, summary: '' };
	}

	const oldLines = oldBody === '' ? [] : oldBody.split('\n');
	const newLines = newBody === '' ? [] : newBody.split('\n');

	if (oldLines.length === 0 || newLines.length === 0) {
		const addedCount = newLines.length;
		const removedCount = oldLines.length;
		const parts: string[] = [];
		if (addedCount > 0) parts.push(`${addedCount} line${addedCount !== 1 ? 's' : ''} added`);
		if (removedCount > 0)
			parts.push(`${removedCount} line${removedCount !== 1 ? 's' : ''} removed`);
		return { isIdentical: false, changeRatio: 1, summary: parts.join(', ') };
	}

	// Build LCS length table
	const m = oldLines.length;
	const n = newLines.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	const lcsLength = dp[m][n];
	const totalLines = Math.max(m, n);
	const changedLines = totalLines - lcsLength;
	const changeRatio = totalLines > 0 ? changedLines / totalLines : 0;

	// Backtrack to find changed positions in newLines for heading context
	const changedNewLineIndices: number[] = [];
	let i = m;
	let j = n;
	while (i > 0 && j > 0) {
		if (oldLines[i - 1] === newLines[j - 1]) {
			i--;
			j--;
		} else if (dp[i - 1][j] >= dp[i][j - 1]) {
			i--;
		} else {
			changedNewLineIndices.push(j - 1);
			j--;
		}
	}

	// Count added vs removed lines
	const addedCount = n - lcsLength;
	const removedCount = m - lcsLength;

	// Build summary
	const parts: string[] = [];
	if (addedCount > 0) parts.push(`${addedCount} line${addedCount !== 1 ? 's' : ''} added`);
	if (removedCount > 0) parts.push(`${removedCount} line${removedCount !== 1 ? 's' : ''} removed`);

	// Find nearest heading for context
	if (changedNewLineIndices.length > 0) {
		const firstChangedIndex = changedNewLineIndices[changedNewLineIndices.length - 1];
		const heading = findNearestHeading(newLines, firstChangedIndex);
		if (heading) {
			parts.push(`near "${heading}"`);
		}
	}

	return {
		isIdentical: false,
		changeRatio: Math.min(1, changeRatio),
		summary: parts.join(', '),
	};
};

/**
 * Generate a patch string from oldBody to newBody using diff-match-patch.
 * Also counts the total characters added and removed.
 */
export const generateNotePatch = (
	oldBody: string,
	newBody: string,
): { patchText: string; added: number; removed: number } => {
	if (oldBody === newBody) {
		return { patchText: '', added: 0, removed: 0 };
	}

	const dmp = new diff_match_patch();
	const diffs = dmp.diff_main(oldBody, newBody);
	dmp.diff_cleanupSemantic(diffs);

	let added = 0;
	let removed = 0;
	for (const [op, text] of diffs) {
		if (op === 1) added += text.length;
		if (op === -1) removed += text.length;
	}

	const patches = dmp.patch_make(oldBody, diffs);
	return { patchText: dmp.patch_toText(patches), added, removed };
};

/**
 * Generate a unified-diff-style string optimised for LLM consumption.
 *
 * Each change block is headed by `@@ near "<heading>" @@` (or just `@@` when
 * no Markdown heading precedes the change).  Context lines are prefixed with a
 * space, removed lines with `-`, added lines with `+`.  Multiple blocks are
 * separated by a blank line.
 */
export const generateLLMFriendlyDiff = (
	oldBody: string,
	newBody: string,
	contextLines = 2,
): string => {
	if (oldBody === newBody) return '';

	const oldLines = oldBody === '' ? [] : oldBody.split('\n');
	const hunks = computeDiffHunks(oldBody, newBody);

	const blocks: string[] = [];
	let oldLineIdx = 0; // tracks position in oldLines as we walk hunks

	let i = 0;
	while (i < hunks.length) {
		if (hunks[i].type === 'unchanged') {
			oldLineIdx += hunks[i].lines.length;
			i++;
			continue;
		}

		// Collect consecutive removed/added hunks into one change group
		const startOldIdx = oldLineIdx;
		const removedLines: string[] = [];
		const addedLines: string[] = [];

		while (i < hunks.length && hunks[i].type !== 'unchanged') {
			const h = hunks[i];
			if (h.type === 'removed') {
				removedLines.push(...h.lines);
				oldLineIdx += h.lines.length;
			} else {
				// added — does not advance old line pointer
				addedLines.push(...h.lines);
			}
			i++;
		}

		// Context before: last N lines of the preceding unchanged block
		const ctxBeforeStart = Math.max(0, startOldIdx - contextLines);
		const ctxBefore = oldLines.slice(ctxBeforeStart, startOldIdx);

		// Context after: first N lines of the next unchanged hunk (if any)
		let ctxAfter: string[] = [];
		if (i < hunks.length && hunks[i].type === 'unchanged') {
			ctxAfter = hunks[i].lines.slice(0, contextLines);
		}

		// Find nearest heading by scanning backwards from startOldIdx
		const heading = findNearestHeading(oldLines, startOldIdx - 1);
		const atLine = heading ? `@@ near "${heading}" @@` : '@@';

		const diffLines: string[] = [atLine];
		for (const l of ctxBefore) diffLines.push(` ${l}`);
		for (const l of removedLines) diffLines.push(`-${l}`);
		for (const l of addedLines) diffLines.push(`+${l}`);
		for (const l of ctxAfter) diffLines.push(` ${l}`);

		blocks.push(diffLines.join('\n'));
	}

	return blocks.join('\n\n');
};
