import { computeDiffHunks, DiffHunk, computeDiffWithGroups, reconstructBody } from '../diff-lines';

describe('computeDiffHunks', () => {
	it('returns empty array when both bodies are empty', () => {
		expect(computeDiffHunks('', '')).toEqual([]);
	});

	it('returns unchanged hunk when bodies are identical', () => {
		const body = 'line1\nline2\nline3';
		expect(computeDiffHunks(body, body)).toEqual([
			{ type: 'unchanged', lines: ['line1', 'line2', 'line3'] },
		]);
	});

	it('returns added hunk when old body is empty', () => {
		expect(computeDiffHunks('', 'new line 1\nnew line 2')).toEqual([
			{ type: 'added', lines: ['new line 1', 'new line 2'] },
		]);
	});

	it('returns removed hunk when new body is empty', () => {
		expect(computeDiffHunks('old line 1\nold line 2', '')).toEqual([
			{ type: 'removed', lines: ['old line 1', 'old line 2'] },
		]);
	});

	it('produces removed then added for a changed line', () => {
		const oldBody = 'line1\nold line2\nline3';
		const newBody = 'line1\nnew line2\nline3';
		const result = computeDiffHunks(oldBody, newBody);
		const types = result.map((h: DiffHunk) => h.type);
		expect(types).toContain('removed');
		expect(types).toContain('added');
		expect(types).toContain('unchanged');
		const removed = result.find((h: DiffHunk) => h.type === 'removed');
		const added = result.find((h: DiffHunk) => h.type === 'added');
		expect(removed?.lines).toContain('old line2');
		expect(added?.lines).toContain('new line2');
	});

	it('detects inserted lines', () => {
		const oldBody = 'line1\nline2';
		const newBody = 'line1\nnew line\nline2';
		const result = computeDiffHunks(oldBody, newBody);
		const added = result.find((h: DiffHunk) => h.type === 'added');
		expect(added?.lines).toEqual(['new line']);
	});

	it('detects removed lines', () => {
		const oldBody = 'line1\nremoved line\nline2';
		const newBody = 'line1\nline2';
		const result = computeDiffHunks(oldBody, newBody);
		const removed = result.find((h: DiffHunk) => h.type === 'removed');
		expect(removed?.lines).toEqual(['removed line']);
	});

	it('merges consecutive unchanged lines into one hunk', () => {
		const body = 'a\nb\nc\nd';
		const result = computeDiffHunks(body, body);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({ type: 'unchanged', lines: ['a', 'b', 'c', 'd'] });
	});

	it('merges consecutive removed lines into one hunk', () => {
		const result = computeDiffHunks('a\nb\nc', 'c');
		const removed = result.find((h: DiffHunk) => h.type === 'removed');
		expect(removed?.lines).toEqual(['a', 'b']);
		const unchanged = result.find((h: DiffHunk) => h.type === 'unchanged');
		expect(unchanged?.lines).toEqual(['c']);
	});

	it('merges consecutive added lines into one hunk', () => {
		const result = computeDiffHunks('c', 'a\nb\nc');
		const added = result.find((h: DiffHunk) => h.type === 'added');
		expect(added?.lines).toEqual(['a', 'b']);
		const unchanged = result.find((h: DiffHunk) => h.type === 'unchanged');
		expect(unchanged?.lines).toEqual(['c']);
	});

	it('handles single-line bodies that differ', () => {
		const result = computeDiffHunks('hello', 'world');
		expect(result).toContainEqual({ type: 'removed', lines: ['hello'] });
		expect(result).toContainEqual({ type: 'added', lines: ['world'] });
	});

	it('preserves empty lines in hunks', () => {
		const oldBody = 'a\n\nb';
		const newBody = 'a\n\nc';
		const result = computeDiffHunks(oldBody, newBody);
		const unchanged = result.find((h: DiffHunk) => h.type === 'unchanged');
		expect(unchanged?.lines).toContain('a');
		expect(unchanged?.lines).toContain('');
	});

	it('handles multiple changed sections', () => {
		const oldBody = 'a\nb\nc\nd\ne';
		const newBody = 'a\nB\nc\nD\ne';
		const result = computeDiffHunks(oldBody, newBody);
		const removedHunks = result.filter((h: DiffHunk) => h.type === 'removed');
		const addedHunks = result.filter((h: DiffHunk) => h.type === 'added');
		expect(removedHunks.length).toBeGreaterThanOrEqual(1);
		expect(addedHunks.length).toBeGreaterThanOrEqual(1);
		const allRemoved = removedHunks.flatMap((h: DiffHunk) => h.lines);
		const allAdded = addedHunks.flatMap((h: DiffHunk) => h.lines);
		expect(allRemoved).toContain('b');
		expect(allRemoved).toContain('d');
		expect(allAdded).toContain('B');
		expect(allAdded).toContain('D');
	});
});

describe('computeDiffWithGroups', () => {
	it('returns zero groups for identical bodies', () => {
		const body = 'a\nb\nc';
		const result = computeDiffWithGroups(body, body);
		expect(result.groups).toHaveLength(0);
		expect(result.segments).toEqual([{ type: 'unchanged', lines: ['a', 'b', 'c'] }]);
	});

	it('returns zero groups and empty segments for empty identical bodies', () => {
		const result = computeDiffWithGroups('', '');
		expect(result.groups).toHaveLength(0);
		expect(result.segments).toHaveLength(0);
	});

	it('returns one group for a single line change', () => {
		const result = computeDiffWithGroups('a\nold\nb', 'a\nnew\nb');
		expect(result.groups).toHaveLength(1);
		expect(result.groups[0].removedLines).toEqual(['old']);
		expect(result.groups[0].addedLines).toEqual(['new']);
	});

	it('includes context lines before and after a change', () => {
		const result = computeDiffWithGroups(
			'ctx1\nctx2\nold\nctx3\nctx4',
			'ctx1\nctx2\nnew\nctx3\nctx4',
		);
		const group = result.groups[0];
		expect(group.contextBefore).toContain('ctx2');
		expect(group.contextAfter).toContain('ctx3');
	});

	it('context includes at most 2 lines', () => {
		const old = 'a\nb\nc\nd\nOLD\ne\nf\ng\nh';
		const newB = 'a\nb\nc\nd\nNEW\ne\nf\ng\nh';
		const result = computeDiffWithGroups(old, newB);
		const group = result.groups[0];
		expect(group.contextBefore.length).toBeLessThanOrEqual(2);
		expect(group.contextAfter.length).toBeLessThanOrEqual(2);
		// Last 2 lines before the change
		expect(group.contextBefore).toEqual(['c', 'd']);
		expect(group.contextAfter).toEqual(['e', 'f']);
	});

	it('returns two groups for two separate changes', () => {
		const result = computeDiffWithGroups('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne');
		expect(result.groups).toHaveLength(2);
		expect(result.groups[0].removedLines).toEqual(['b']);
		expect(result.groups[0].addedLines).toEqual(['B']);
		expect(result.groups[1].removedLines).toEqual(['d']);
		expect(result.groups[1].addedLines).toEqual(['D']);
	});

	it('builds segments alternating unchanged and changed', () => {
		const result = computeDiffWithGroups('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne');
		const types = result.segments.map((s) => s.type);
		expect(types).toEqual(['unchanged', 'changed', 'unchanged', 'changed', 'unchanged']);
	});

	it('returns one group for pure addition (empty old)', () => {
		const result = computeDiffWithGroups('', 'x\ny');
		expect(result.groups).toHaveLength(1);
		expect(result.groups[0].addedLines).toEqual(['x', 'y']);
		expect(result.groups[0].removedLines).toEqual([]);
	});

	it('returns one group for pure deletion (empty new)', () => {
		const result = computeDiffWithGroups('x\ny', '');
		expect(result.groups).toHaveLength(1);
		expect(result.groups[0].removedLines).toEqual(['x', 'y']);
		expect(result.groups[0].addedLines).toEqual([]);
	});

	it('assigns unique ids to each group', () => {
		const result = computeDiffWithGroups('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne');
		const ids = result.groups.map((g) => g.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('reconstructBody', () => {
	const old2 = 'line1\nline2\nline3\nline4\nline5';
	const new2 = 'line1\nNEW2\nline3\nNEW4\nline5';

	it('accepting all groups produces newBody', () => {
		const diff = computeDiffWithGroups(old2, new2);
		const allIds = new Set(diff.groups.map((g) => g.id));
		expect(reconstructBody(old2, new2, allIds, diff)).toBe(new2);
	});

	it('rejecting all groups produces oldBody', () => {
		const diff = computeDiffWithGroups(old2, new2);
		expect(reconstructBody(old2, new2, new Set(), diff)).toBe(old2);
	});

	it('accepting first group, rejecting second gives partial result', () => {
		const diff = computeDiffWithGroups(old2, new2);
		const firstGroupId = new Set([diff.groups[0].id]);
		const result = reconstructBody(old2, new2, firstGroupId, diff);
		expect(result).toBe('line1\nNEW2\nline3\nline4\nline5');
	});

	it('rejecting first group, accepting second gives partial result', () => {
		const diff = computeDiffWithGroups(old2, new2);
		const secondGroupId = new Set([diff.groups[1].id]);
		const result = reconstructBody(old2, new2, secondGroupId, diff);
		expect(result).toBe('line1\nline2\nline3\nNEW4\nline5');
	});

	it('works for single group edit — accept', () => {
		const oldB = 'hello\nworld';
		const newB = 'hello\nearth';
		const diff = computeDiffWithGroups(oldB, newB);
		const allIds = new Set(diff.groups.map((g) => g.id));
		expect(reconstructBody(oldB, newB, allIds, diff)).toBe(newB);
	});

	it('works for single group edit — reject', () => {
		const oldB = 'hello\nworld';
		const newB = 'hello\nearth';
		const diff = computeDiffWithGroups(oldB, newB);
		expect(reconstructBody(oldB, newB, new Set(), diff)).toBe(oldB);
	});

	it('handles pure addition accept', () => {
		const diff = computeDiffWithGroups('', 'a\nb');
		const allIds = new Set(diff.groups.map((g) => g.id));
		expect(reconstructBody('', 'a\nb', allIds, diff)).toBe('a\nb');
	});

	it('handles pure addition reject', () => {
		const diff = computeDiffWithGroups('', 'a\nb');
		expect(reconstructBody('', 'a\nb', new Set(), diff)).toBe('');
	});
});
