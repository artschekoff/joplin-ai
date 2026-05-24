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

needsNoteBody = true  → request explicitly involves reading or changing the CURRENT note's text.
                        This includes: edit, fix, improve, proofread, translate, summarize,
                        reformat, rewrite, expand, shorten, insert, append content INTO the current note.
needsNoteBody = false → request does NOT need the current note's text body. Use false when:
                        - purely structural: copy, duplicate, delete, move, open, tag, search, list notebooks/tags.
                        - web search only (web_search): "find", "search the internet", "look up".
                        - creating new notes on a different topic (create_note): user asks to create one
                          or more NEW notes/documents about external topics (not derived from the current note).
                        - a combination of web_search + create_note for a new topic.
                        When in doubt, use false.`;

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

const FALLBACK: RequestPlan = { needsNoteBody: false, likelyTools: [] };

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
