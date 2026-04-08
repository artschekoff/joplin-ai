import { AIProvider, AIResponse } from './types';
import { callOpenAI } from './openai';
import { callClaude } from './claude';

const NOTE_EDIT_OPEN = '<note_edit>';
const NOTE_EDIT_CLOSE = '</note_edit>';

export function buildSystemPrompt(noteTitle: string, noteBody: string): string {
	const truncated =
		noteBody.length > 30000
			? noteBody.substring(0, 30000) + '\n\n[... note truncated due to length ...]'
			: noteBody;

	return `You are an AI assistant integrated into the Joplin note editor.
The user's current note is provided below. The note is in Markdown format.

If the user asks to edit, modify, rewrite, translate, fix, format, or otherwise change the note content, return ONLY the complete new note content wrapped in ${NOTE_EDIT_OPEN}...${NOTE_EDIT_CLOSE} tags. Do not include any explanation outside these tags when editing.

If the user asks a question or requests information that does not require changing the note, answer normally in Markdown without using the ${NOTE_EDIT_OPEN} tags.

Current note title: ${noteTitle}
Current note content:
${truncated}`;
}

export function parseResponse(raw: string): AIResponse {
	const editStart = raw.indexOf(NOTE_EDIT_OPEN);
	const editEnd = raw.lastIndexOf(NOTE_EDIT_CLOSE);

	if (editStart !== -1 && editEnd !== -1 && editEnd > editStart) {
		const editedBody = raw.substring(editStart + NOTE_EDIT_OPEN.length, editEnd).trim();
		return { content: raw, isEdit: true, editedBody };
	}

	return { content: raw, isEdit: false };
}

export const validateApiKey = (provider: AIProvider, apiKey: string): void => {
	if (!apiKey?.trim()) {
		throw new Error(
			`API key for ${provider} is not configured. Go to Settings → AI Assistant to set it up.`,
		);
	}
};

export async function sendToAI(
	provider: AIProvider,
	apiKey: string,
	model: string,
	userPrompt: string,
	noteTitle: string,
	noteBody: string,
): Promise<AIResponse> {
	validateApiKey(provider, apiKey);
	const systemPrompt = buildSystemPrompt(noteTitle, noteBody);

	let raw: string;
	if (provider === 'openai') {
		raw = await callOpenAI(apiKey, model, systemPrompt, userPrompt);
	} else {
		raw = await callClaude(apiKey, model, systemPrompt, userPrompt);
	}

	return parseResponse(raw);
}
