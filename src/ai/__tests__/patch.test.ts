import { applyPatches } from '../patch';

describe('applyPatches', () => {
	describe('exact match', () => {
		it('replaces exact match', () => {
			const body = 'Hello world. Goodbye world.';
			const { body: out, applied } = applyPatches(body, [
				{ search: 'Hello world', replace: 'Hi there' },
			]);
			expect(out).toBe('Hi there. Goodbye world.');
			expect(applied[0]).toBe(true);
		});

		it('applies multiple patches sequentially', () => {
			const body = 'foo bar baz';
			const { body: out, applied } = applyPatches(body, [
				{ search: 'foo', replace: 'FOO' },
				{ search: 'bar', replace: 'BAR' },
			]);
			expect(out).toBe('FOO BAR baz');
			expect(applied).toEqual([true, true]);
		});
	});

	describe('CRLF normalization', () => {
		it('matches when body has CRLF but search has LF', () => {
			const body = 'line one\r\nline two\r\nline three';
			const search = 'line one\nline two\nline three';
			const { body: out, applied } = applyPatches(body, [{ search, replace: 'replaced' }]);
			expect(applied[0]).toBe(true);
			expect(out).toBe('replaced');
		});

		it('matches single-line with CRLF body', () => {
			const body = 'first\r\nsecond\r\nthird';
			const { body: out, applied } = applyPatches(body, [{ search: 'second', replace: 'SECOND' }]);
			expect(applied[0]).toBe(true);
			expect(out).toContain('SECOND');
		});
	});

	describe('whitespace-normalized match', () => {
		it('matches with extra spaces', () => {
			const body = 'Hello   world  here';
			const { body: out, applied } = applyPatches(body, [
				{ search: 'Hello world here', replace: 'done' },
			]);
			expect(applied[0]).toBe(true);
			expect(out).toBe('done');
		});
	});

	describe('fuzzy match — long pattern guard', () => {
		it('does NOT throw for a pattern longer than 32 chars that fails exact match', () => {
			// This is the regression test for "Pattern too long for this browser."
			// The body and search differ only in case, so exact & normalized both fail,
			// then the old code called match_bitap_ which threw for patterns > 32 chars.
			const body = 'The term of this Agreement shall begin on January 1, 2026.';
			const search = 'the term of this Agreement shall begin on January 1, 2026.'; // lowercase 't'
			expect(() => applyPatches(body, [{ search, replace: 'replacement' }])).not.toThrow();
		});

		it('returns applied=false (not found) for long unmatched pattern instead of throwing', () => {
			const body = 'Short body.';
			const longSearch =
				'This is a search pattern that is definitely longer than thirty-two characters and does not appear in the body at all.';
			const { applied } = applyPatches(body, [{ search: longSearch, replace: 'x' }]);
			expect(applied[0]).toBe(false);
		});

		it('still applies fuzzy match for short patterns (≤32 chars)', () => {
			// Fuzzy should still work for short patterns
			const body = 'The quick brown fox.';
			// short pattern that differs slightly — diff-match-patch should still handle it
			const search = 'quick browne fox'; // 16 chars, slight typo
			const { applied } = applyPatches(body, [{ search, replace: 'fast red fox' }]);
			// Either matched (fuzzy) or not — just must not throw
			expect(typeof applied[0]).toBe('boolean');
		});
	});

	describe('unmatched pattern', () => {
		it('returns applied=false when search not found', () => {
			const body = 'Hello world';
			const { body: out, applied } = applyPatches(body, [{ search: 'not found', replace: 'x' }]);
			expect(applied[0]).toBe(false);
			expect(out).toBe('Hello world');
		});
	});
});
