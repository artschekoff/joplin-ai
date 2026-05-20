import { AIProvider } from './types';
import { sendOpenAIMessages } from './openai';
import { sendClaudeMessages } from './claude';
import { sendPerplexityRequest } from './perplexity';

export interface RequestPlan {
	needsNoteBody: boolean;
	likelyTools: string[];
}

const PLANNER_SYSTEM = `You are a planning assistant for a Joplin notes AI.

Given a user request and the title of the currently open note, identify which tools will be needed and whether the note's full text content must be available.

Available tools:
get_note, open_note, patch_note, update_note, create_note, copy_note, delete_note, move_note,
search_notes, list_notebooks, create_notebook, add_tag, remove_tag, list_tags,
web_search, generate_image, remove_resource

Return JSON only — no explanation, no markdown:
{"likelyTools": ["tool1", "tool2"], "needsNoteBody": boolean}

needsNoteBody = true  → request involves reading or changing the CURRENT note's text in any way.
                        This includes: add, edit, remove, translate, summarize, fix, reformat,
                        insert, append, rewrite, write about X, improve, proofread, expand, shorten.
                        When in doubt, use true.
needsNoteBody = false → ONLY for purely structural actions that never touch the current note's text:
                        copy, duplicate, delete, move, open, tag, search, list notebooks/tags.
                        "create new note" is false ONLY when the user explicitly asks for a NEW note
                        with a different topic (not modifying the current one).`;

const parseResponse = (text: string): RequestPlan | null => {
	try {
		const match = /\{[\s\S]*?\}/.exec(text);
		if (!match) return null;
		const parsed = JSON.parse(match[0]);
		if (typeof parsed.needsNoteBody !== 'boolean') return null;
		return {
			needsNoteBody: parsed.needsNoteBody,
			likelyTools: Array.isArray(parsed.likelyTools) ? (parsed.likelyTools as string[]) : [],
		};
	} catch {
		return null;
	}
};

const FALLBACK: RequestPlan = { needsNoteBody: true, likelyTools: [] };

export const planUserRequest = async (
	provider: AIProvider,
	apiKey: string,
	model: string,
	userPrompt: string,
	noteTitle: string,
): Promise<RequestPlan> => {
	const userMsg = `Note title: "${noteTitle}"\nUser request: ${userPrompt}`;
	try {
		let text: string | null | undefined;
		if (provider === 'openai') {
			const res = await sendOpenAIMessages(apiKey, model, [
				{ role: 'system', content: PLANNER_SYSTEM },
				{ role: 'user', content: userMsg },
			]);
			text = res.textContent;
		} else if (provider === 'claude' || provider === 'claudecode') {
			const res = await sendClaudeMessages(apiKey, model, PLANNER_SYSTEM, [
				{ role: 'user', content: userMsg },
			]);
			text = res.textContent;
		} else if (provider === 'perplexity') {
			const res = await sendPerplexityRequest(apiKey, model, userMsg, PLANNER_SYSTEM);
			text = res.textContent;
		}
		return parseResponse(text ?? '') ?? FALLBACK;
	} catch {
		return FALLBACK;
	}
};
