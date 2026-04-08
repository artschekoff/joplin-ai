import { AIProvider, AIResponse, AIToolCall, AIActionOutcome } from './types';
import { sendOpenAIMessages } from './openai';
import { sendClaudeMessages } from './claude';
import { getOpenAITools, getClaudeTools } from './tools';
import { executeAction } from '../actions/registry';
import { ActionContext } from '../actions/types';

const MAX_TOOL_ROUNDS = 5;

export const buildSystemPrompt = (noteTitle: string, noteBody: string): string => {
	const truncated =
		noteBody.length > 30000
			? noteBody.substring(0, 30000) + '\n\n[... note truncated due to length ...]'
			: noteBody;

	return `You are an AI assistant integrated into the Joplin note editor.
The user's current note is provided below. The note is in Markdown format.

You have tools to interact with Joplin. Always use them for actions:
- create_note: Create a new note (title, body, optional notebook).
- get_note: Read a note by ID (useful after search).
- update_note: Update the current note's title and/or body.
- delete_note: Delete a note (always ask for confirmation first).
- move_note: Move a note to a different notebook.
- search_notes: Search notes by text query.
- list_notebooks: List all notebooks and their IDs.
- create_notebook: Create a new notebook.
- add_tag / remove_tag: Add or remove a tag on a note.
- list_tags: List tags globally or for a specific note.

If the user asks a question that does not require changing anything, answer normally in Markdown without using tools.

Current note title: ${noteTitle}
Current note content:
${truncated}`;
};

export const validateApiKey = (provider: AIProvider, apiKey: string): void => {
	if (!apiKey?.trim()) {
		throw new Error(
			`API key for ${provider} is not configured. Go to Settings → AI Assistant to set it up.`,
		);
	}
};

const runToolCalls = async (
	toolCalls: AIToolCall[],
	context: ActionContext,
): Promise<{
	outcomes: AIActionOutcome[];
	results: Array<{ toolCallId: string; content: string }>;
}> => {
	const outcomes: AIActionOutcome[] = [];
	const results: Array<{ toolCallId: string; content: string }> = [];

	for (const tc of toolCalls) {
		const actionResult = await executeAction(tc.name, tc.args, context);
		outcomes.push({
			action: tc.name,
			success: actionResult.success,
			message: actionResult.message,
			data: actionResult.data,
		});
		results.push({ toolCallId: tc.id, content: JSON.stringify(actionResult) });
	}

	return { outcomes, results };
};

const runOpenAILoop = async (
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
	context: ActionContext,
): Promise<{ text: string; outcomes: AIActionOutcome[] }> => {
	const tools = getOpenAITools();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const messages: any[] = [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userPrompt },
	];
	const allOutcomes: AIActionOutcome[] = [];

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await sendOpenAIMessages(apiKey, model, messages, tools);

		if (response.toolCalls.length === 0) {
			return { text: response.textContent || '', outcomes: allOutcomes };
		}

		messages.push(response.rawAssistantMessage);

		const { outcomes, results } = await runToolCalls(response.toolCalls, context);
		allOutcomes.push(...outcomes);

		for (const r of results) {
			messages.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
		}
	}

	const finalResponse = await sendOpenAIMessages(apiKey, model, messages);
	return { text: finalResponse.textContent || '', outcomes: allOutcomes };
};

const runClaudeLoop = async (
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
	context: ActionContext,
): Promise<{ text: string; outcomes: AIActionOutcome[] }> => {
	const tools = getClaudeTools();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const messages: any[] = [{ role: 'user', content: userPrompt }];
	const allOutcomes: AIActionOutcome[] = [];

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await sendClaudeMessages(apiKey, model, systemPrompt, messages, tools);

		if (response.toolCalls.length === 0) {
			return { text: response.textContent || '', outcomes: allOutcomes };
		}

		messages.push(response.rawAssistantMessage);

		const { outcomes, results } = await runToolCalls(response.toolCalls, context);
		allOutcomes.push(...outcomes);

		const toolResultBlocks = results.map((r) => ({
			type: 'tool_result' as const,
			tool_use_id: r.toolCallId,
			content: r.content,
		}));
		messages.push({ role: 'user', content: toolResultBlocks });
	}

	const finalResponse = await sendClaudeMessages(apiKey, model, systemPrompt, messages);
	return { text: finalResponse.textContent || '', outcomes: allOutcomes };
};

export const sendToAI = async (
	provider: AIProvider,
	apiKey: string,
	model: string,
	userPrompt: string,
	noteTitle: string,
	noteBody: string,
	context?: ActionContext,
): Promise<AIResponse> => {
	validateApiKey(provider, apiKey);
	const systemPrompt = buildSystemPrompt(noteTitle, noteBody);
	const actionContext: ActionContext = context ?? {
		currentNoteId: null,
		currentNoteTitle: noteTitle,
	};

	const { text, outcomes } =
		provider === 'openai'
			? await runOpenAILoop(apiKey, model, systemPrompt, userPrompt, actionContext)
			: await runClaudeLoop(apiKey, model, systemPrompt, userPrompt, actionContext);

	const hasNoteUpdate = outcomes.some((o) => o.action === 'update_note' && o.success);

	return {
		content: text,
		isEdit: hasNoteUpdate,
		editedBody: undefined,
		actions: outcomes,
	};
};
