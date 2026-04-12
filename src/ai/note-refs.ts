const NOTE_REF_PATTERN = /@\[([^\]]+)\]/g;

/**
 * Extracts unique note titles from `@[Title]` references in a string.
 */
export const parseNoteReferences = (text: string): string[] => {
	const matches: string[] = [];
	let match: RegExpExecArray | null;
	const pattern = new RegExp(NOTE_REF_PATTERN.source, 'g');
	while ((match = pattern.exec(text)) !== null) {
		const title = match[1].trim();
		if (title.length > 0 && !matches.includes(title)) {
			matches.push(title);
		}
	}
	return matches;
};

/**
 * Replaces `@[Title]` with just `Title` in the prompt text sent to the AI.
 */
export const stripNoteReferences = (text: string): string => text.replace(NOTE_REF_PATTERN, '$1');
