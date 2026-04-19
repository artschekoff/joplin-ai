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
		if (removedCount > 0) parts.push(`${removedCount} line${removedCount !== 1 ? 's' : ''} removed`);
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
