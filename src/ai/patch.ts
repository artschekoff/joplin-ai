import * as DiffMatchPatch from 'diff-match-patch';

export interface SearchReplacePatch {
	search: string;
	replace: string;
}

export interface PatchResult {
	body: string;
	/** Per-patch success flags: true = applied, false = not found */
	applied: boolean[];
}

/**
 * Apply SEARCH/REPLACE patches to a note body.
 * Strategy: exact match first, fuzzy via diff-match-patch as fallback.
 */
export const applyPatches = (body: string, patches: SearchReplacePatch[]): PatchResult => {
	const dmp = new DiffMatchPatch();
	let result = body;
	const applied: boolean[] = [];

	for (const patch of patches) {
		const search = patch.search.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const replace = patch.replace.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

		// 1. Exact match
		const exactIdx = result.indexOf(search);
		if (exactIdx !== -1) {
			result = result.substring(0, exactIdx) + replace + result.substring(exactIdx + search.length);
			applied.push(true);
			continue;
		}

		// 2. Whitespace-normalized match
		const normalize = (s: string) => s.replace(/[ \t]+/g, ' ').trim();
		const normalizedResult = result.split('\n').map(normalize).join('\n');
		const normalizedSearch = search.split('\n').map(normalize).join('\n');
		const normIdx = normalizedResult.indexOf(normalizedSearch);
		if (normIdx !== -1) {
			// Find corresponding position in original text by counting newlines
			const linesBefore = normalizedResult.substring(0, normIdx).split('\n').length - 1;
			const originalLines = result.split('\n');
			const searchLines = search.split('\n').length;
			const startLine = linesBefore;
			const endLine = startLine + searchLines;
			const before = originalLines.slice(0, startLine).join('\n');
			const after = originalLines.slice(endLine).join('\n');
			result = (before ? before + '\n' : '') + replace + (after ? '\n' + after : '');
			applied.push(true);
			continue;
		}

		// 3. Fuzzy match via diff-match-patch: find approximate location, then replace
		dmp.Match_Threshold = 0.5;
		const loc = dmp.match_main(result, search, Math.floor(result.length / 2));
		if (loc !== -1) {
			result = result.substring(0, loc) + replace + result.substring(loc + search.length);
			applied.push(true);
			continue;
		}

		applied.push(false);
	}

	return { body: result, applied };
};
