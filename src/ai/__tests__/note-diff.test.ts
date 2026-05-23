import { computeNoteDiff, generateNotePatch } from '../note-diff';

describe('computeNoteDiff', () => {
	describe('identical bodies', () => {
		it('returns isIdentical true when bodies are equal', () => {
			const body = 'Hello\nWorld\n## Section\nContent';
			const result = computeNoteDiff(body, body);
			expect(result.isIdentical).toBe(true);
		});

		it('returns changeRatio 0 when bodies are identical', () => {
			const body = 'Line one\nLine two';
			const result = computeNoteDiff(body, body);
			expect(result.changeRatio).toBe(0);
		});

		it('returns empty summary when bodies are identical', () => {
			const result = computeNoteDiff('same', 'same');
			expect(result.summary).toBe('');
		});

		it('treats empty strings as identical', () => {
			const result = computeNoteDiff('', '');
			expect(result.isIdentical).toBe(true);
			expect(result.changeRatio).toBe(0);
		});
	});

	describe('completely different bodies', () => {
		it('returns isIdentical false when bodies differ', () => {
			const result = computeNoteDiff('old content', 'completely new text');
			expect(result.isIdentical).toBe(false);
		});

		it('returns changeRatio 1.0 when nothing overlaps', () => {
			const result = computeNoteDiff('aaa\nbbb\nccc', 'xxx\nyyy\nzzz');
			expect(result.changeRatio).toBe(1);
		});

		it('includes changed line count in summary', () => {
			const result = computeNoteDiff('a\nb\nc', 'x\ny\nz');
			expect(result.summary).toMatch(/3/);
		});
	});

	describe('partial changes', () => {
		it('returns low changeRatio for single line change in large body', () => {
			const lines = Array.from({ length: 20 }, (_, i) => `Line ${i}`);
			const oldBody = lines.join('\n');
			const newLines = [...lines];
			newLines[10] = 'CHANGED LINE';
			const newBody = newLines.join('\n');
			const result = computeNoteDiff(oldBody, newBody);
			expect(result.changeRatio).toBeLessThan(0.15);
			expect(result.isIdentical).toBe(false);
		});

		it('returns high changeRatio for large rewrites', () => {
			const oldBody = Array.from({ length: 10 }, (_, i) => `Original line ${i}`).join('\n');
			const newBody = Array.from({ length: 10 }, (_, i) => `Totally different ${i * 100}`).join(
				'\n',
			);
			const result = computeNoteDiff(oldBody, newBody);
			expect(result.changeRatio).toBeGreaterThanOrEqual(0.15);
		});

		it('returns changeRatio between 0 and 1 for partial changes', () => {
			const result = computeNoteDiff('a\nb\nc\nd', 'a\nX\nc\nd');
			expect(result.changeRatio).toBeGreaterThan(0);
			expect(result.changeRatio).toBeLessThan(1);
		});

		it('includes non-zero count in summary for partial changes', () => {
			const result = computeNoteDiff('a\nb\nc\nd', 'a\nX\nc\nd');
			expect(result.summary).toBeTruthy();
			expect(result.summary.length).toBeGreaterThan(0);
		});
	});

	describe('added lines', () => {
		it('detects lines added at end', () => {
			const result = computeNoteDiff('a\nb', 'a\nb\nc\nd');
			expect(result.isIdentical).toBe(false);
			expect(result.changeRatio).toBeGreaterThan(0);
		});

		it('summary mentions added lines', () => {
			const result = computeNoteDiff('a\nb', 'a\nb\nc\nd');
			expect(result.summary).toMatch(/add/i);
		});
	});

	describe('removed lines', () => {
		it('detects lines removed', () => {
			const result = computeNoteDiff('a\nb\nc\nd', 'a\nb');
			expect(result.isIdentical).toBe(false);
			expect(result.changeRatio).toBeGreaterThan(0);
		});

		it('summary mentions removed lines', () => {
			const result = computeNoteDiff('a\nb\nc\nd', 'a\nb');
			expect(result.summary).toMatch(/remov/i);
		});
	});

	describe('heading context in summary', () => {
		it('includes nearest heading in summary when lines changed near a heading', () => {
			const oldBody = '## Introduction\nSome text\n\n## Methods\nOld method text\n';
			const newBody = '## Introduction\nSome text\n\n## Methods\nNew method text\n';
			const result = computeNoteDiff(oldBody, newBody);
			expect(result.summary).toContain('Methods');
		});
	});

	describe('edge cases', () => {
		it('handles single line change correctly', () => {
			const result = computeNoteDiff('only line', 'changed line');
			expect(result.isIdentical).toBe(false);
			expect(result.changeRatio).toBe(1);
		});

		it('handles old body empty, new body has content', () => {
			const result = computeNoteDiff('', 'new content\nsecond line');
			expect(result.isIdentical).toBe(false);
			expect(result.changeRatio).toBe(1);
		});

		it('handles new body empty, old body had content', () => {
			const result = computeNoteDiff('some content\nmore content', '');
			expect(result.isIdentical).toBe(false);
			expect(result.changeRatio).toBe(1);
		});

		it('changeRatio is always between 0 and 1 inclusive', () => {
			const cases = [
				['', ''],
				['a', 'a'],
				['a', 'b'],
				['a\nb\nc', 'x\ny'],
				['a\nb', 'a\nb\nc\nd\ne'],
			];
			for (const [old, next] of cases) {
				const result = computeNoteDiff(old, next);
				expect(result.changeRatio).toBeGreaterThanOrEqual(0);
				expect(result.changeRatio).toBeLessThanOrEqual(1);
			}
		});
	});
});

describe('generateNotePatch', () => {
	it('returns empty patchText for identical bodies', () => {
		const body = 'Same content\n';
		const result = generateNotePatch(body, body);
		expect(result.patchText).toBe('');
		expect(result.added).toBe(0);
		expect(result.removed).toBe(0);
	});

	it('detects a line replacement', () => {
		const old = 'Hello world\nSecond line\n';
		const updated = 'Hello world\nModified line\n';
		const result = generateNotePatch(old, updated);
		expect(result.patchText.length).toBeGreaterThan(0);
		expect(result.removed).toBeGreaterThan(0);
		expect(result.added).toBeGreaterThan(0);
	});

	it('counts only added chars when lines are appended', () => {
		const old = 'Line one\n';
		const updated = 'Line one\nLine two\n';
		const result = generateNotePatch(old, updated);
		expect(result.patchText.length).toBeGreaterThan(0);
		expect(result.added).toBeGreaterThan(0);
		expect(result.removed).toBe(0);
	});
});
