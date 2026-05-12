import { AIProvider } from './types';
import { sendOpenAIMessages } from './openai';
import { sendClaudeMessages } from './claude';
import { sendPerplexityRequest } from './perplexity';

const CLASSIFIER_SYSTEM = `You are a routing assistant for a Joplin notes AI. Given a user request and the title of their currently open note, decide whether the assistant needs to read the FULL TEXT CONTENT of that note to fulfill the request.

Reply YES if the request involves: reading, summarizing, translating, analyzing, explaining, rewriting, fixing, improving, formatting, proofreading, or otherwise working with the note's text.
Reply NO if the request involves: copying, duplicating, deleting, moving, renaming, tagging, searching, creating new notes, or any action that does not require reading the note's text content.

Reply with exactly one word: YES or NO.`;

/**
 * Ask the AI itself whether the note body is needed for this request.
 * Returns true (include body) or false (omit; AI can call get_note if needed).
 * Falls back to false on error.
 */
export const classifyNeedsNoteBody = async (
	provider: AIProvider,
	apiKey: string,
	model: string,
	prompt: string,
	noteTitle: string,
): Promise<boolean> => {
	const userMsg = `Note title: "${noteTitle}"\nUser request: ${prompt}`;
	try {
		if (provider === 'openai') {
			const res = await sendOpenAIMessages(apiKey, model, [
				{ role: 'system', content: CLASSIFIER_SYSTEM },
				{ role: 'user', content: userMsg },
			]);
			return /^y/i.test((res.textContent ?? '').trim());
		}
		if (provider === 'claude' || provider === 'claudecode') {
			const res = await sendClaudeMessages(apiKey, model, CLASSIFIER_SYSTEM, [
				{ role: 'user', content: userMsg },
			]);
			return /^y/i.test((res.textContent ?? '').trim());
		}
		if (provider === 'perplexity') {
			const res = await sendPerplexityRequest(apiKey, model, userMsg, CLASSIFIER_SYSTEM);
			return /^y/i.test((res.textContent ?? '').trim());
		}
	} catch {
		return false;
	}
	return false;
};
