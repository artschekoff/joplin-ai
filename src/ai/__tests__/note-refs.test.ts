import { parseNoteReferences, stripNoteReferences } from '../note-refs';

describe('parseNoteReferences', () => {
	it('returns empty array when no references present', () => {
		expect(parseNoteReferences('Hello world')).toEqual([]);
	});

	it('parses a single @[Note Title] reference', () => {
		expect(parseNoteReferences('Check @[My Note] for details')).toEqual(['My Note']);
	});

	it('parses multiple references', () => {
		expect(parseNoteReferences('Compare @[Note A] with @[Note B]')).toEqual(['Note A', 'Note B']);
	});

	it('handles reference at start of string', () => {
		expect(parseNoteReferences('@[First Note] has info')).toEqual(['First Note']);
	});

	it('handles reference at end of string', () => {
		expect(parseNoteReferences('See @[Last Note]')).toEqual(['Last Note']);
	});

	it('handles special characters in note title', () => {
		expect(parseNoteReferences('Read @[Notes & Ideas (2024)]')).toEqual(['Notes & Ideas (2024)']);
	});

	it('returns unique titles when same note referenced multiple times', () => {
		expect(parseNoteReferences('@[Same] and @[Same] again')).toEqual(['Same']);
	});

	it('does not match bare @ without brackets', () => {
		expect(parseNoteReferences('email user@example.com')).toEqual([]);
	});

	it('does not match empty brackets', () => {
		expect(parseNoteReferences('empty @[] reference')).toEqual([]);
	});

	it('handles reference with only whitespace in brackets', () => {
		expect(parseNoteReferences('blank @[   ] reference')).toEqual([]);
	});
});

describe('stripNoteReferences', () => {
	it('removes @[Title] syntax and keeps just the title', () => {
		expect(stripNoteReferences('Check @[My Note] for details')).toBe('Check My Note for details');
	});

	it('handles multiple references', () => {
		expect(stripNoteReferences('Compare @[A] with @[B]')).toBe('Compare A with B');
	});

	it('returns original string when no references', () => {
		expect(stripNoteReferences('No references here')).toBe('No references here');
	});
});
