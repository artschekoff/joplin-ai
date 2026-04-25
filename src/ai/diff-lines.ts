export interface DiffHunk {
	type: 'unchanged' | 'removed' | 'added';
	lines: string[];
}

/**
 * Compute a structured line-level diff between two text bodies.
 * Uses LCS backtracking to produce hunks of unchanged/removed/added lines.
 */
export interface ChangeGroup {
	id: string;
	removedLines: string[];
	addedLines: string[];
	contextBefore: string[];
	contextAfter: string[];
}

export type DiffSegment =
	| { type: 'unchanged'; lines: string[] }
	| { type: 'changed'; groupId: string };

export interface DiffWithGroups {
	groups: ChangeGroup[];
	segments: DiffSegment[];
}

export const computeDiffWithGroups = (oldBody: string, newBody: string): DiffWithGroups => {
	const hunks = computeDiffHunks(oldBody, newBody);
	if (hunks.length === 0) return { groups: [], segments: [] };

	const groups: ChangeGroup[] = [];
	const segments: DiffSegment[] = [];
	let i = 0;

	while (i < hunks.length) {
		if (hunks[i].type === 'unchanged') {
			segments.push({ type: 'unchanged', lines: hunks[i].lines });
			i++;
		} else {
			const removedLines: string[] = [];
			const addedLines: string[] = [];
			while (i < hunks.length && hunks[i].type !== 'unchanged') {
				if (hunks[i].type === 'removed') removedLines.push(...hunks[i].lines);
				else addedLines.push(...hunks[i].lines);
				i++;
			}
			const prevSeg = segments.length > 0 ? segments[segments.length - 1] : null;
			const contextBefore = prevSeg && prevSeg.type === 'unchanged' ? prevSeg.lines.slice(-2) : [];
			const contextAfter =
				i < hunks.length && hunks[i].type === 'unchanged' ? hunks[i].lines.slice(0, 2) : [];
			const group: ChangeGroup = {
				id: `grp_${groups.length + 1}_${Math.random().toString(36).substring(2, 7)}`,
				removedLines,
				addedLines,
				contextBefore,
				contextAfter,
			};
			groups.push(group);
			segments.push({ type: 'changed', groupId: group.id });
		}
	}

	return { groups, segments };
};

export const reconstructBody = (
	_oldBody: string,
	_newBody: string,
	acceptedGroupIds: Set<string>,
	diff: DiffWithGroups,
): string => {
	const groupMap = new Map(diff.groups.map((g) => [g.id, g]));
	const lines: string[] = [];

	for (const seg of diff.segments) {
		if (seg.type === 'unchanged') {
			lines.push(...seg.lines);
		} else {
			const group = groupMap.get(seg.groupId);
			if (!group) continue;
			lines.push(...(acceptedGroupIds.has(seg.groupId) ? group.addedLines : group.removedLines));
		}
	}

	return lines.join('\n');
};

export const computeDiffHunks = (oldBody: string, newBody: string): DiffHunk[] => {
	const oldLines = oldBody === '' ? [] : oldBody.split('\n');
	const newLines = newBody === '' ? [] : newBody.split('\n');

	if (oldLines.length === 0 && newLines.length === 0) return [];
	if (oldLines.length === 0) return [{ type: 'added', lines: newLines }];
	if (newLines.length === 0) return [{ type: 'removed', lines: oldLines }];

	// Build LCS table
	const m = oldLines.length;
	const n = newLines.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] =
				oldLines[i - 1] === newLines[j - 1]
					? dp[i - 1][j - 1] + 1
					: Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}

	// Backtrack to build edit sequence
	type EditOp = { type: 'unchanged' | 'removed' | 'added'; line: string };
	const ops: EditOp[] = [];
	let i = m;
	let j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			ops.push({ type: 'unchanged', line: oldLines[i - 1] });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			ops.push({ type: 'added', line: newLines[j - 1] });
			j--;
		} else {
			ops.push({ type: 'removed', line: oldLines[i - 1] });
			i--;
		}
	}
	ops.reverse();

	// Merge consecutive same-type ops into hunks
	const hunks: DiffHunk[] = [];
	for (const op of ops) {
		if (hunks.length > 0 && hunks[hunks.length - 1].type === op.type) {
			hunks[hunks.length - 1].lines.push(op.line);
		} else {
			hunks.push({ type: op.type, lines: [op.line] });
		}
	}

	return hunks;
};
