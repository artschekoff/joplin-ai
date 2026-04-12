import {
	AIProvider,
	AIResponse,
	AIToolCall,
	AIActionOutcome,
	ChatMessage,
	WorkMode,
} from './types';
import { sendOpenAIMessages } from './openai';
import { sendClaudeMessages } from './claude';
import {
	sendPerplexityRequest,
	PerplexityInputItem,
	sendSonarChatRequest,
	isSonarApiModel,
	SonarChatMessage,
	parseSonarToolCalls,
	buildSonarToolCallPrompt,
} from './perplexity';
import { getOpenAITools, getClaudeTools, getPerplexityTools } from './tools';
import { executeAction, READ_ONLY_ACTIONS } from '../actions/registry';
import { ActionContext, AttachedFile, Notebook, ReferencedNote } from '../actions/types';

const MAX_TOOL_ROUNDS = 5;
const TOOL_LIMIT_NOTICE =
	'\n\n---\n*Tool call limit reached. Some actions may not have been completed. Please continue the conversation to finish remaining tasks.*';

const buildNotebookSection = (notebooks: Notebook[]): string => {
	if (notebooks.length === 0) return '';
	const lines = notebooks.map((nb) => `- "${nb.title}" (id: ${nb.id})`);
	return `\n\nAvailable notebooks (use the id as parentId when creating notes, or as targetNotebookId when moving notes — choose the best matching notebook based on the note's title and content):
${lines.join('\n')}`;
};

const buildWorkModeSection = (workMode?: WorkMode): string => {
	if (!workMode || workMode === 'agent') return '';
	if (workMode === 'ask') {
		return `[Work Mode: Ask]
You are in READ-ONLY mode. Do not create, update, delete, or modify any notes, notebooks, or tags. You may only read, search, and list existing content. If the user asks you to make changes, politely explain that you are in Ask mode and cannot modify notes.
[End Work Mode]

`;
	}
	return `[Work Mode: Edit]
You are in EDIT mode. Every user request should be interpreted as an instruction to modify the content of the currently opened note. Use the update_note tool to apply changes to the current note. Focus exclusively on editing the current note's content. If the user reports an error, fix the relevant content in the note and provide comments in your response.
[End Work Mode]

`;
};

const MAX_NOTE_BODY_LENGTH = 30000;
const MAX_REF_NOTE_LENGTH = 10000;

const detectTruncatedSonarToolCall = (
	responseText: string,
	workMode: WorkMode | undefined,
	readOnlyActions: ReadonlySet<string>,
): { blocked: boolean; action: string; modeLabel: string } | null => {
	const toolCallMarkerIdx = responseText.indexOf('[TOOL_CALL]');
	if (toolCallMarkerIdx === -1) return null;
	const markerRegion = responseText.substring(toolCallMarkerIdx);
	const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(markerRegion);
	if (!nameMatch) return null;
	if (!workMode || workMode === 'agent') return null;
	if (readOnlyActions.has(nameMatch[1])) return null;
	const modeLabel = workMode === 'ask' ? 'Ask' : 'Edit';
	return { blocked: true, action: nameMatch[1], modeLabel };
};

const buildReferencedNotesSection = (notes: ReferencedNote[]): string => {
	if (notes.length === 0) return '';
	const sections = notes.map((n) => {
		const body =
			n.body.length > MAX_REF_NOTE_LENGTH
				? n.body.substring(0, MAX_REF_NOTE_LENGTH) + '\n[... content truncated ...]'
				: n.body;
		return `--- "${n.title}" (id: ${n.id}) ---\n${body}`;
	});
	return `\n\nReferenced notes (the user explicitly mentioned these notes — use their content as additional context):\n${sections.join('\n\n')}`;
};

const MAX_ATTACHED_FILE_LENGTH = 30000;

const buildAttachedFilesSection = (files: AttachedFile[]): string => {
	if (files.length === 0) return '';
	const sections = files.map((f) => {
		const content =
			f.content.length > MAX_ATTACHED_FILE_LENGTH
				? f.content.substring(0, MAX_ATTACHED_FILE_LENGTH) + '\n[... content truncated ...]'
				: f.content;
		return `--- "${f.name}" (${f.mimeType}, ${f.size} bytes) ---\n${content}`;
	});
	return `\n\nAttached files (the user uploaded these files — use their content as additional context):\n${sections.join('\n\n')}`;
};

export interface BuildSystemPromptOptions {
	noteTitle: string;
	noteBody: string;
	notebooks?: Notebook[];
	agentRolePrompt?: string;
	workMode?: WorkMode;
	referencedNotes?: ReferencedNote[];
	attachedFiles?: AttachedFile[];
}

export const buildSystemPrompt = (options: BuildSystemPromptOptions): string => {
	const {
		noteTitle,
		noteBody,
		notebooks,
		agentRolePrompt,
		workMode,
		referencedNotes,
		attachedFiles,
	} = options;
	const truncated =
		noteBody.length > MAX_NOTE_BODY_LENGTH
			? noteBody.substring(0, MAX_NOTE_BODY_LENGTH) + '\n\n[... note truncated due to length ...]'
			: noteBody;
	const notebookSection = notebooks?.length ? buildNotebookSection(notebooks) : '';
	const referencedSection = referencedNotes?.length
		? buildReferencedNotesSection(referencedNotes)
		: '';
	const attachedSection = attachedFiles?.length ? buildAttachedFilesSection(attachedFiles) : '';
	const roleSection = agentRolePrompt?.trim()
		? `[Agent Role]\n${agentRolePrompt}\n[End Agent Role]\n\n`
		: '';
	const modeSection = buildWorkModeSection(workMode);

	return `${roleSection}${modeSection}You are an AI assistant integrated into the Joplin note editor.
The user's current note is provided below. The note is in Markdown format.

You have tools to interact with Joplin:
- create_note: Create a new note (title, body, optional notebook).
- get_note: Read a note by ID (useful after search to retrieve content).
- open_note: Open a note in Joplin's editor by ID. Use this when the user wants to navigate to or view a note. Prefer this over get_note when the user says "open", "go to", or "show" a note.
- update_note: Update a note's title and/or body by ID, or the current note if no ID given.
- delete_note: Delete a note by ID.
- move_note: Move a note to a different notebook.
- search_notes: Search notes using Joplin query syntax. Supports filters: title:, body:, tag:, notebook:, created:, updated:, type:, iscompleted:, and boolean operators (any:1 for OR, - prefix to negate). Construct queries using relevant filters when the user mentions specific notebooks, tags, dates, or note types.
- list_notebooks: List all notebooks and their IDs.
- create_notebook: Create a new notebook.
- add_tag / remove_tag: Add or remove a tag on a note.
- list_tags: List tags globally or for a specific note.
- web_search: Search the web for current information. Returns results with source citations. Use when the user asks about recent events, current data, or topics not covered in their notes.
- generate_image: Generate an image from a text description. Supports aspect ratio (1:1, 3:2, 2:3), quality (medium, high), and visual style. The image is downloaded at full quality and attached to the note as a resource.
- remove_resource: Remove an image or attachment from a note. First use get_note to find the resource IDs (they appear as ![alt](:/RESOURCE_ID) in the note body), then call remove_resource with the resource ID to strip the reference and delete the resource. Always use this tool to remove images — never pass resource paths or filenames as a note ID.

TOOL USAGE RULES:
- For non-destructive actions (create, read, search, move, tag, update), use the tool immediately without asking for confirmation.
- Only ask for confirmation before destructive actions like delete_note.
- When the user confirms a previously discussed action (e.g. "yes", "go ahead", "do it"), execute it immediately using the appropriate tool.
- If the user provides enough information (e.g. title and content for a new note), call the tool right away.
- When creating or moving a note, automatically select the most appropriate notebook based on the note's title and content. Do not ask the user which notebook to use unless ambiguous.
- If the user asks a question that does not require any action, answer normally in Markdown without using tools.
${notebookSection}${referencedSection}${attachedSection}
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
	history?: ChatMessage[],
): Promise<{ text: string; outcomes: AIActionOutcome[] }> => {
	const tools = getOpenAITools(context.workMode);
	const historyMessages = (history ?? []).map((m) => ({ role: m.role, content: m.content }));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const messages: any[] = [
		{ role: 'system', content: systemPrompt },
		...historyMessages,
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
	return { text: (finalResponse.textContent || '') + TOOL_LIMIT_NOTICE, outcomes: allOutcomes };
};

const runClaudeLoop = async (
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
	context: ActionContext,
	history?: ChatMessage[],
): Promise<{ text: string; outcomes: AIActionOutcome[] }> => {
	const tools = getClaudeTools(context.workMode);
	const historyMessages = (history ?? []).map((m) => ({ role: m.role, content: m.content }));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const messages: any[] = [...historyMessages, { role: 'user', content: userPrompt }];
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
	return { text: (finalResponse.textContent || '') + TOOL_LIMIT_NOTICE, outcomes: allOutcomes };
};

const runPerplexityLoop = async (
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
	context: ActionContext,
	history?: ChatMessage[],
): Promise<{ text: string; outcomes: AIActionOutcome[] }> => {
	const tools = getPerplexityTools(context.workMode);
	const historyItems: PerplexityInputItem[] = (history ?? []).map((m) => ({
		role: m.role,
		content: m.content,
	}));
	let input: string | PerplexityInputItem[] =
		historyItems.length > 0 ? [...historyItems, { role: 'user', content: userPrompt }] : userPrompt;
	const allOutcomes: AIActionOutcome[] = [];

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await sendPerplexityRequest(apiKey, model, input, systemPrompt, tools);

		if (response.toolCalls.length === 0) {
			return { text: response.textContent || '', outcomes: allOutcomes };
		}

		const rawOutput = response.rawAssistantMessage as PerplexityInputItem[];
		const nextInput: PerplexityInputItem[] = [...rawOutput];

		const { outcomes, results } = await runToolCalls(response.toolCalls, context);
		allOutcomes.push(...outcomes);

		for (const r of results) {
			nextInput.push({
				type: 'function_call_output',
				call_id: r.toolCallId,
				output: r.content,
			});
		}

		input = nextInput;
	}

	const finalResponse = await sendPerplexityRequest(apiKey, model, input, systemPrompt);
	return { text: (finalResponse.textContent || '') + TOOL_LIMIT_NOTICE, outcomes: allOutcomes };
};

const runSonarLoop = async (
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
	context: ActionContext,
	history?: ChatMessage[],
): Promise<{ text: string; outcomes: AIActionOutcome[] }> => {
	const tools = getPerplexityTools(context.workMode);
	const toolPrompt = buildSonarToolCallPrompt(tools);
	const enhancedSystemPrompt = systemPrompt + toolPrompt;
	const messages: SonarChatMessage[] = [
		{ role: 'system', content: enhancedSystemPrompt },
		...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
		{ role: 'user', content: userPrompt },
	];
	const allOutcomes: AIActionOutcome[] = [];
	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await sendSonarChatRequest(apiKey, model, messages);
		const responseText = response.textContent || '';
		const { toolCalls, cleanText } = parseSonarToolCalls(responseText);
		if (toolCalls.length === 0) {
			const truncated = detectTruncatedSonarToolCall(
				responseText,
				context.workMode,
				READ_ONLY_ACTIONS,
			);
			if (truncated) {
				allOutcomes.push({
					action: truncated.action,
					success: false,
					message: `Action "${truncated.action}" is not allowed in ${truncated.modeLabel} mode.`,
				});
				return {
					text: `Cannot perform "${truncated.action}" in ${truncated.modeLabel} mode. Switch to Agent mode to enable all actions.`,
					outcomes: allOutcomes,
				};
			}
			return { text: cleanText || responseText, outcomes: allOutcomes };
		}
		messages.push({ role: 'assistant', content: responseText });
		const { outcomes, results } = await runToolCalls(toolCalls, context);
		allOutcomes.push(...outcomes);
		const resultSummary = results.map((r) => r.content).join('\n');
		messages.push({ role: 'user', content: `[TOOL_RESULT]\n${resultSummary}\n[/TOOL_RESULT]` });
	}
	const finalResponse = await sendSonarChatRequest(apiKey, model, messages);
	const finalText = finalResponse.textContent || '';
	const parsed = parseSonarToolCalls(finalText);
	return { text: (parsed.cleanText || finalText) + TOOL_LIMIT_NOTICE, outcomes: allOutcomes };
};

export const sendToAI = async (
	provider: AIProvider,
	apiKey: string,
	model: string,
	userPrompt: string,
	noteTitle: string,
	noteBody: string,
	context?: ActionContext,
	history?: ChatMessage[],
): Promise<AIResponse> => {
	validateApiKey(provider, apiKey);
	const actionContext: ActionContext = context ?? {
		currentNoteId: null,
		currentNoteTitle: noteTitle,
	};
	const systemPrompt = buildSystemPrompt({
		noteTitle,
		noteBody,
		notebooks: actionContext.notebooks,
		agentRolePrompt: actionContext.agentRolePrompt,
		workMode: actionContext.workMode,
		referencedNotes: actionContext.referencedNotes,
		attachedFiles: actionContext.attachedFiles,
	});

	const runLoop = () => {
		if (provider === 'openai')
			return runOpenAILoop(apiKey, model, systemPrompt, userPrompt, actionContext, history);
		if (provider === 'perplexity') {
			if (isSonarApiModel(model))
				return runSonarLoop(apiKey, model, systemPrompt, userPrompt, actionContext, history);
			return runPerplexityLoop(apiKey, model, systemPrompt, userPrompt, actionContext, history);
		}
		return runClaudeLoop(apiKey, model, systemPrompt, userPrompt, actionContext, history);
	};
	const { text, outcomes } = await runLoop();

	const hasNoteUpdate = outcomes.some((o) => o.action === 'update_note' && o.success);

	return {
		content: text,
		isEdit: hasNoteUpdate,
		editedBody: undefined,
		actions: outcomes,
	};
};
