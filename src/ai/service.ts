import {
	AIProvider,
	AIResponse,
	AIToolCall,
	AIActionOutcome,
	ChatMessage,
	WorkMode,
	TokenUsage,
	NoteContextSnapshot,
} from './types';
import { generateNotePatch } from './note-diff';
import { streamOpenAIMessages } from './openai';
import { streamClaudeMessages } from './claude';
import {
	sendPerplexityRequest,
	PerplexityInputItem,
	sendSonarChatRequest,
	isSonarApiModel,
	isPerplexityNativeModel,
	SonarChatMessage,
	parseSonarToolCalls,
	buildSonarToolCallPrompt,
} from './perplexity';
import { getOpenAITools, getClaudeTools, getPerplexityTools } from './tools';
import { executeAction, READ_ONLY_ACTIONS, EDIT_ACTIONS } from '../actions/registry';
import { ActionContext, AttachedFile, Notebook, ReferencedNote } from '../actions/types';
import { CostTracker, defaultCostTracker } from './cost-tracker';

const MAX_TOOL_ROUNDS = 5;

const TOOL_STEP_LABELS: Record<string, string> = {
	create_note: 'Creating note...',
	copy_note: 'Copying note...',
	get_note: 'Reading note...',
	open_note: 'Opening note...',
	update_note: 'Updating note...',
	patch_note: 'Patching note...',
	delete_note: 'Deleting note...',
	move_note: 'Moving note...',
	search_notes: 'Searching notes...',
	list_notebooks: 'Listing notebooks...',
	create_notebook: 'Creating notebook...',
	add_tag: 'Tagging note...',
	remove_tag: 'Removing tag...',
	list_tags: 'Listing tags...',
	web_search: 'Searching the web...',
	generate_image: 'Generating image...',
	remove_resource: 'Removing attachment...',
};
const TOOL_LIMIT_NOTICE =
	'\n\n---\n*Tool call limit reached. Some actions may not have been completed. Please continue the conversation to finish remaining tasks.*';

const buildNotebookSection = (notebooks: Notebook[]): string => {
	if (notebooks.length === 0) return '';
	const lines = notebooks.map((nb) => `- "${nb.title}" (id: ${nb.id})`);
	return `\n\nAvailable notebooks (use the id as parentId when creating notes, or as targetNotebookId when moving notes — choose the best matching notebook based on the note's title and content):
${lines.join('\n')}`;
};

const buildWorkModeSection = (workMode?: WorkMode, noteTitle?: string): string => {
	if (!workMode || workMode === 'agent') return '';
	if (workMode === 'ask') {
		return `[Work Mode: Ask]
You are in READ-ONLY mode. Do not create, update, delete, or modify any notes, notebooks, or tags. You may only read, search, and list existing content. If the user asks you to make changes, politely explain that you are in Ask mode and cannot modify notes.
[End Work Mode]

`;
	}
	const titleRef = noteTitle ? ` ("${noteTitle}")` : '';
	return `[Work Mode: Edit]
You are in EDIT mode. Your only task is to edit the body of the currently open note${titleRef}.

Rules:
- Every user message is an immediate edit instruction — execute it right away without asking for confirmation or suggestions.
- Apply only the exact change requested. Do not make additional edits or improvements beyond what was asked.
- Use patch_note for targeted edits (changing a section, fixing text, inserting content). Use update_note only for complete rewrites. Never pass a noteId to either tool.
- You may search, read, and list other notes for reference — but never create, delete, or modify them.
- The note title is read-only in Edit mode. Only the body can be changed.
[End Work Mode]

`;
};

const MAX_NOTE_BODY_LENGTH = 30000;
const MAX_REF_NOTE_LENGTH = 10000;

/**
 * Normalize text encoding at AI boundaries:
 * - CRLF / isolated CR — LF
 * - U+2028 line separator, U+2029 paragraph separator — LF
 * - Non-breaking and other Unicode space variants — regular space
 * - U+FFFD replacement character (bad encoding artifact) — removed
 */
const sanitizeContent = (text: string): string =>
	text
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/\u2028|\u2029/g, '\n')
		.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
		.replace(/\uFFFD/g, '');

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
	const allowed = workMode === 'ask' ? readOnlyActions : EDIT_ACTIONS;
	if (allowed.has(nameMatch[1])) return null;
	const modeLabel = workMode === 'ask' ? 'Ask' : 'Edit';
	return { blocked: true, action: nameMatch[1], modeLabel };
};

const buildReferencedNotesSection = (notes: ReferencedNote[]): string => {
	if (notes.length === 0) return '';
	const sections = notes.map((n) => {
		const sanitized = sanitizeContent(n.body);
		const body =
			sanitized.length > MAX_REF_NOTE_LENGTH
				? sanitized.substring(0, MAX_REF_NOTE_LENGTH) + '\n[... content truncated ...]'
				: sanitized;
		return `--- "${n.title}" (id: ${n.id}) ---\n${body}`;
	});
	return `\n\nReferenced notes (the user explicitly mentioned these notes — use their content as additional context):\n${sections.join('\n\n')}`;
};

const MAX_ATTACHED_FILE_LENGTH = 30000;

const buildAttachedFilesSection = (files: AttachedFile[]): string => {
	const textFiles = files.filter((f) => !f.base64Data);
	if (textFiles.length === 0) return '';
	const sections = textFiles.map((f) => {
		const sanitized = sanitizeContent(f.content);
		const content =
			sanitized.length > MAX_ATTACHED_FILE_LENGTH
				? sanitized.substring(0, MAX_ATTACHED_FILE_LENGTH) + '\n[... content truncated ...]'
				: sanitized;
		return `--- "${f.name}" (${f.mimeType}, ${f.size} bytes) ---\n${content}`;
	});
	return `\n\nAttached files (the user uploaded these files — use their content as additional context):\n${sections.join('\n\n')}`;
};

const isImageAttachment = (f: AttachedFile): boolean =>
	!!f.base64Data && f.mimeType.startsWith('image/');

const isPdfAttachment = (f: AttachedFile): boolean =>
	!!f.base64Data && f.mimeType === 'application/pdf';

/**
 * Build OpenAI-format content parts for base64 PDF attachments.
 * Returns an array of `{ type: "file", file: { ... } }` content blocks.
 */
export const buildOpenAIPdfParts = (
	files: AttachedFile[],
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] =>
	files.filter(isPdfAttachment).map((f) => ({
		type: 'file',
		file: {
			filename: f.name,
			file_data: `data:application/pdf;base64,${f.base64Data}`,
		},
	}));

/**
 * Build Claude-format content blocks for base64 PDF attachments.
 * Returns an array of `{ type: "document", source: { ... } }` content blocks.
 */
export const buildClaudePdfParts = (
	files: AttachedFile[],
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] =>
	files.filter(isPdfAttachment).map((f) => ({
		type: 'document',
		source: {
			type: 'base64',
			media_type: 'application/pdf',
			data: f.base64Data,
		},
		title: f.name,
	}));

/**
 * Build OpenAI-format content parts for base64 image attachments.
 * Returns an array of `{ type: "image_url", image_url: { url: "data:..." } }` blocks.
 */
export const buildOpenAIImageParts = (
	files: AttachedFile[],
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] =>
	files.filter(isImageAttachment).map((f) => ({
		type: 'image_url',
		image_url: { url: `data:${f.mimeType};base64,${f.base64Data}` },
	}));

/**
 * Build Claude-format content blocks for base64 image attachments.
 * Returns an array of `{ type: "image", source: { ... } }` content blocks.
 */
export const buildClaudeImageParts = (
	files: AttachedFile[],
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] =>
	files.filter(isImageAttachment).map((f) => ({
		type: 'image',
		source: {
			type: 'base64',
			media_type: f.mimeType,
			data: f.base64Data,
		},
	}));

export interface BuildSystemPromptOptions {
	noteTitle: string;
	noteId?: string;
	noteBody: string;
	notebooks?: Notebook[];
	agentRolePrompt?: string;
	workMode?: WorkMode;
	referencedNotes?: ReferencedNote[];
	attachedFiles?: AttachedFile[];
	/** When true, the selected model has native built-in web search (e.g. Perplexity). Replaces the web_search tool description with a native search note. */
	nativeWebSearch?: boolean;
	/** When true, a specific fragment of the note is selected by the user. */
	isSelection?: boolean;
	/** The markdown text of the selected fragment. Used to mark the relevant section inside the full note body. */
	selectionText?: string;
	/** When true, the note body is intentionally excluded from the prompt to save tokens. A placeholder is shown instead. */
	noteBodyOmitted?: boolean;
	/** When set, the AI already has this note body in its message history (injected as synthetic pair). */
	noteContextInHistory?: NoteContextSnapshot;
	/** Kie.ai API key — when absent, generate_image is excluded from the tool list. */
	kieApiKey?: string;
}

/**
 * System prompt split into three parts for optimal provider prompt caching.
 * - `staticInstructions`: role, mode, tool descriptions, rules — stable across requests
 * - `noteBodyContext`: current note body (or diff/omission placeholder) — stable when note unchanged
 * - `dynamicContext`: notebooks, referenced notes, attachments — changes per request
 *
 * Concatenating all three yields the full system prompt.
 */
export interface SystemPromptParts {
	staticInstructions: string;
	noteBodyContext: string;
	dynamicContext: string;
	/** True when the note's full body is embedded in noteBodyContext. */
	bodyIncluded: boolean;
	/** Set only when a diff-match-patch patch was emitted instead of the full body. */
	diffStats?: { added: number; removed: number };
}

const buildWebSearchToolLine = (nativeWebSearch?: boolean): string => {
	if (nativeWebSearch) {
		return '(This model has native built-in web search — answer questions about recent events and current data directly without using any tool.)';
	}
	return '- web_search: Search the web for current information. Returns results with source citations. Use when the user asks about recent events, current data, or topics not covered in their notes.';
};

/**
 * When the user has selected a fragment, embed `>>>SELECTED<<<` / `<<<END_SELECTED>>>`
 * markers around that fragment inside the full note body so the AI can see the
 * full context while knowing exactly which portion to modify.
 */
const embedSelectionMarkers = (fullBody: string, selectionText: string): string => {
	const idx = fullBody.indexOf(selectionText);
	if (idx === -1) return fullBody;
	return (
		fullBody.substring(0, idx) +
		'>>>SELECTED<<<\n' +
		selectionText +
		'\n<<<END_SELECTED>>>' +
		fullBody.substring(idx + selectionText.length)
	);
};

/**
 * Resolve the note body content for the prompt given diff state.
 * Returns `{ bodyText, contentLabel, omitted }` so callers can build
 * `noteBodyContext` without repeating this logic.
 */
const resolveNoteBodyContent = ({
	noteBody,
	noteBodyOmitted,
	isSelection,
	selectionText,
}: {
	noteBody: string;
	noteBodyOmitted?: boolean;
	workMode?: WorkMode;
	isSelection?: boolean;
	selectionText?: string;
}): { bodyText: string; contentLabel: string; omitted: boolean } => {
	if (noteBodyOmitted) {
		return { bodyText: '', contentLabel: '', omitted: true };
	}

	const cleanBody = sanitizeContent(noteBody);
	const hasSelectionMarkers = isSelection && selectionText && cleanBody.includes(selectionText);
	const markedBody = hasSelectionMarkers
		? embedSelectionMarkers(cleanBody, selectionText)
		: cleanBody;
	const truncated =
		markedBody.length > MAX_NOTE_BODY_LENGTH
			? markedBody.substring(0, MAX_NOTE_BODY_LENGTH) + '\n\n[... note truncated due to length ...]'
			: markedBody;

	return { bodyText: truncated, contentLabel: 'Current note content:', omitted: false };
};

export const buildSystemPromptParts = (options: BuildSystemPromptOptions): SystemPromptParts => {
	const {
		noteTitle,
		noteId,
		noteBody,
		notebooks,
		agentRolePrompt,
		workMode,
		referencedNotes,
		attachedFiles,
		nativeWebSearch,
		isSelection,
		selectionText,
		noteBodyOmitted,
		noteContextInHistory,
		kieApiKey,
	} = options;

	// ── Note-context-in-history optimisation ──────────────────────────────────
	// Skip or diff the note body when the AI already has it in message history.
	// Edit mode always gets the full body so update_note has complete content.
	let noteContextOverride: {
		noteBodyContext: string;
		bodyIncluded: boolean;
		diffStats?: { added: number; removed: number };
	} | null = null;

	if (
		!noteBodyOmitted &&
		noteContextInHistory &&
		noteContextInHistory.noteId === noteId &&
		workMode !== 'edit'
	) {
		const noteIdLine = noteId ? `Current note ID: ${noteId}\n` : '';

		if (noteContextInHistory.noteBody === noteBody) {
			// Unchanged — AI already has it in history
			noteContextOverride = {
				noteBodyContext: `\nCurrent note title: ${noteTitle}\n${noteIdLine}The note content was provided at the start of this conversation. Refer to your conversation context.\n`,
				bodyIncluded: false,
			};
		} else {
			const patch = generateNotePatch(noteContextInHistory.noteBody, noteBody);
			if (
				patch.patchText.length > 0 &&
				patch.patchText.length <= Math.max(noteBody.length * 0.5, 200)
			) {
				noteContextOverride = {
					noteBodyContext: `\nCurrent note title: ${noteTitle}\n${noteIdLine}[NOTE CHANGED]\nThe note has changed since the start of this conversation. Apply this patch to your memory of the original note:\n\n${patch.patchText}\n`,
					bodyIncluded: false,
					diffStats: { added: patch.added, removed: patch.removed },
				};
			}
			// else: patch too large → fall through to full body
		}
	}

	const {
		bodyText,
		contentLabel,
		omitted: bodyOmitted,
	} = resolveNoteBodyContent({
		noteBody,
		noteBodyOmitted,
		workMode,
		isSelection,
		selectionText,
	});

	const cleanBody = sanitizeContent(noteBody);
	const hasSelectionMarkers = isSelection && selectionText && cleanBody.includes(selectionText);
	const notebookSection = notebooks?.length ? buildNotebookSection(notebooks) : '';
	const referencedSection = referencedNotes?.length
		? buildReferencedNotesSection(referencedNotes)
		: '';
	const attachedSection = attachedFiles?.length ? buildAttachedFilesSection(attachedFiles) : '';
	const roleSection = agentRolePrompt?.trim()
		? `[Agent Role]\n${agentRolePrompt}\n[End Agent Role]\n\n`
		: '';
	const modeSection = buildWorkModeSection(workMode, noteTitle);
	const webSearchLine = buildWebSearchToolLine(nativeWebSearch);
	const selectionRulesBlock = hasSelectionMarkers
		? `\nSELECTION RULES:
The user selected a specific fragment marked with >>>SELECTED<<< and <<<END_SELECTED>>> in the note body below.
- Modify ONLY the text between the markers. Keep all other content unchanged.
- Use a SINGLE patch_note call (NOT update_note): set search to the COMPLETE text between the markers (verbatim, without the markers themselves), and set replace to your complete modified version of that selected text. Do not split into multiple patches.
- Do NOT include the >>>SELECTED<<< / <<<END_SELECTED>>> markers in search or replace.
`
		: '';

	const noteIdLine = noteId ? `Current note ID: ${noteId}\n` : '';
	const noteBodyContext = noteContextOverride
		? noteContextOverride.noteBodyContext
		: bodyOmitted
			? `\nCurrent note title: ${noteTitle}\n${noteIdLine}`
			: `\nCurrent note title: ${noteTitle}\n${noteIdLine}${contentLabel}\n${bodyText}`;
	const bodyIncluded = noteContextOverride ? noteContextOverride.bodyIncluded : !bodyOmitted;
	const diffStats = noteContextOverride?.diffStats;

	if (workMode === 'edit') {
		const staticInstructions = `${roleSection}${modeSection}You are an AI assistant integrated into the Joplin note editor.
The user's current note is provided below. The note is in Markdown format.

You have tools to interact with Joplin:
- patch_note: Surgically edit specific sections of the current note. Pass patches: [{search, replace}]. Include surrounding lines in search. Do not pass a noteId — defaults to the current note. Prefer this for all targeted edits.
- update_note: Replace the entire note body. Use ONLY for complete rewrites. Do not pass a noteId.
- copy_note: Duplicate a note by ID (or the current note if no ID given). Fetches content internally — do NOT call get_note first.
- delete_note: Delete a note by ID.
- move_note: Move a note to a different notebook.
- create_note: Create a new note (title, body, optional notebook).
- get_note: Read another note by ID (read-only, for reference).
- open_note: Open a note in Joplin's editor by ID.
- search_notes: Search notes using Joplin query syntax.
- list_notebooks: List all notebooks and their IDs.
- list_tags: List tags globally or for a specific note.
- add_tag / remove_tag: Add or remove a tag on a note.
${webSearchLine}

EDIT MODE RULES:
- If the user asks for a structural operation (copy, delete, move, create a new note), call copy_note / delete_note / move_note / create_note DIRECTLY — do NOT call get_note, search_notes, or list_notebooks first. These tools work by note ID and fetch content internally.
- After copy_note, delete_note, move_note, or create_note succeeds, your task is complete — return your response immediately, do NOT make additional tool calls.
- Use update_note ONLY when the user explicitly asks to modify the text content of the current note. Never call update_note for copy/delete/move requests.
- Never pass a noteId to update_note — it must always target the current note.
- Apply the exact change the user requests — nothing else. Do not make additional edits beyond what was asked.
- For targeted edits (add, remove, or change a specific section), always use patch_note — it is faster and safer than rewriting the full body.
- Use update_note only for complete note rewrites.
- Apply changes immediately without asking for confirmation or clarifying questions. Make your best judgment and act.
- Do NOT change the note title. The title is protected in Edit mode — only the body can be modified.
${selectionRulesBlock}`;
		const dynamicContext = `${referencedSection}${attachedSection}`;
		return { staticInstructions, noteBodyContext, dynamicContext, bodyIncluded, diffStats };
	}

	const noteContextLine = noteContextOverride
		? noteContextOverride.noteBodyContext.includes('[NOTE CHANGED]')
			? 'The note has been modified. A patch is provided below — apply it to your memory of the note.'
			: 'The note content was provided at the start of this conversation.'
		: bodyOmitted
			? 'The current note title and ID are shown below.'
			: "The user's current note is provided below. The note is in Markdown format.";
	const generateImageLine = kieApiKey?.trim()
		? '- generate_image: Generate an image from a text description. Supports aspect ratio (1:1, 3:2, 2:3), quality (medium, high), and visual style. The image is downloaded at full quality and attached to the note as a resource.'
		: '';
	const staticInstructions = `${roleSection}${modeSection}You are an AI assistant integrated into the Joplin note editor.
${noteContextLine}

You have tools to interact with Joplin:
- create_note: Create a new note (title, body, optional notebook).
- copy_note: Duplicate a note by ID (or the current note if no ID given). Fetches note content internally — do NOT call get_note first. Accepts an optional custom title for the copy.
- get_note: Read a note's full content by ID. Only call this when you actually need to read or analyze the note's text. Do NOT call it before copy_note, delete_note, move_note, or other structural operations.
- open_note: Open a note in Joplin's editor by ID. Use this when the user wants to navigate to or view a note. Prefer this over get_note when the user says "open", "go to", or "show" a note.
- patch_note: Surgically edit specific sections of a note without rewriting the full body. Use for targeted changes: adding lines, modifying a paragraph, inserting content. Pass an array of {search, replace} pairs — search must uniquely identify the location (include surrounding lines for context). Prefer this over update_note for all partial edits.
- update_note: Replace the entire note body. Use ONLY for complete rewrites. For targeted edits, use patch_note.
- delete_note: Delete a note by ID.
- move_note: Move a note to a different notebook.
- search_notes: Search notes using Joplin query syntax. Supports filters: title:, body:, tag:, notebook:, created:, updated:, type:, iscompleted:, and boolean operators (any:1 for OR, - prefix to negate). Construct queries using relevant filters when the user mentions specific notebooks, tags, dates, or note types.
- list_notebooks: List all notebooks and their IDs.
- create_notebook: Create a new notebook.
- add_tag / remove_tag: Add or remove a tag on a note.
- list_tags: List tags globally or for a specific note.
${webSearchLine}
${generateImageLine}
- remove_resource: Remove an image or attachment from a note. First use get_note to find the resource IDs (they appear as ![alt](:/RESOURCE_ID) in the note body), then call remove_resource with the resource ID to strip the reference and delete the resource. Always use this tool to remove images — never pass resource paths or filenames as a note ID.

TOOL USAGE RULES:
- For non-destructive actions (create, read, search, move, tag, update), use the tool immediately without asking for confirmation.
- Only ask for confirmation before destructive actions like delete_note.
- When the user confirms a previously discussed action (e.g. "yes", "go ahead", "do it"), execute it immediately using the appropriate tool.
- If the user provides enough information (e.g. title and content for a new note), call the tool right away.
- When creating or moving a note, automatically select the most appropriate notebook based on the note's title and content. Do not ask the user which notebook to use unless ambiguous.
- If the user asks a question that does not require any action, answer normally in Markdown without using tools.
- Before calling patch_note, update_note, or create_note, write one short sentence describing what you are about to do. Then immediately call the tool.
- For targeted edits (add, remove, or change a specific section), always use patch_note — it is faster and safer than rewriting the full body.
- Use update_note only for complete note rewrites.
- STRUCTURAL OPERATIONS: When the user asks to copy, duplicate, delete, or move a note, call copy_note / delete_note / move_note DIRECTLY — do NOT call get_note, search_notes, or list_notebooks first. These tools work by note ID and fetch content internally. Never attempt to manually replicate a note by reading it and calling update_note.
- STOP AFTER STRUCTURAL OPS: After copy_note, delete_note, move_note, or create_note succeeds, your task is complete. Return your response immediately — do NOT make any additional tool calls.
${selectionRulesBlock}`;
	const dynamicContext = `${notebookSection}${referencedSection}${attachedSection}`;
	return { staticInstructions, noteBodyContext, dynamicContext, bodyIncluded, diffStats };
};

export const buildSystemPrompt = (options: BuildSystemPromptOptions): string => {
	const parts = buildSystemPromptParts(options);
	return parts.staticInstructions + parts.noteBodyContext + parts.dynamicContext;
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
	for (const tc of toolCalls) {
		context.onThinkingStep?.({
			step: tc.name,
			label: TOOL_STEP_LABELS[tc.name] ?? 'Processing...',
		});
	}

	const settled = await Promise.all(
		toolCalls.map(async (tc) => {
			const actionResult = await executeAction(tc.name, tc.args, context);
			return {
				outcome: {
					action: tc.name,
					success: actionResult.success,
					message: actionResult.message,
					data: actionResult.data,
				} as AIActionOutcome,
				result: { toolCallId: tc.id, content: JSON.stringify(actionResult) },
			};
		}),
	);

	return {
		outcomes: settled.map((s) => s.outcome),
		results: settled.map((s) => s.result),
	};
};

const accumulateUsage = (total: TokenUsage, add?: TokenUsage): TokenUsage => {
	if (!add) return total;
	const cached =
		total.cachedTokens != null || add.cachedTokens != null
			? (total.cachedTokens ?? 0) + (add.cachedTokens ?? 0)
			: undefined;
	return {
		inputTokens: total.inputTokens + add.inputTokens,
		outputTokens: total.outputTokens + add.outputTokens,
		cachedTokens: cached,
	};
};

const runOpenAILoop = async (
	apiKey: string,
	model: string,
	promptParts: SystemPromptParts,
	userPrompt: string,
	context: ActionContext,
	history?: ChatMessage[],
	noteContext?: NoteContextSnapshot,
): Promise<{ text: string; outcomes: AIActionOutcome[]; usage: TokenUsage }> => {
	const tools = getOpenAITools(context.workMode, context.kieApiKey);
	const historyMessages = (history ?? []).map((m) => ({ role: m.role, content: m.content }));
	const pdfParts = buildOpenAIPdfParts(context.attachedFiles ?? []);
	const imageParts = buildOpenAIImageParts(context.attachedFiles ?? []);
	const mediaParts = [...pdfParts, ...imageParts];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const userMessage: any =
		mediaParts.length > 0
			? { role: 'user', content: [...mediaParts, { type: 'text', text: userPrompt }] }
			: { role: 'user', content: userPrompt };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const noteContextPair: any[] =
		noteContext && noteContext.noteId === context.currentNoteId
			? [
					{
						role: 'user',
						content: `[NOTE_CONTEXT]\nTitle: ${noteContext.noteTitle}\n\n${noteContext.noteBody}`,
					},
					{ role: 'assistant', content: 'Note context received.' },
				]
			: [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const messages: any[] = [
		{ role: 'system', content: promptParts.staticInstructions },
		{ role: 'system', content: promptParts.noteBodyContext },
		{ role: 'system', content: promptParts.dynamicContext },
		...noteContextPair,
		...historyMessages,
		userMessage,
	];
	const allOutcomes: AIActionOutcome[] = [];
	let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
	const onChunk = context.onStreamChunk ?? (() => {});

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await streamOpenAIMessages(apiKey, model, messages, onChunk, tools);
		totalUsage = accumulateUsage(totalUsage, response.usage);

		if (response.toolCalls.length === 0) {
			return { text: response.textContent || '', outcomes: allOutcomes, usage: totalUsage };
		}

		messages.push(response.rawAssistantMessage);

		const { outcomes, results } = await runToolCalls(response.toolCalls, context);
		allOutcomes.push(...outcomes);

		for (const r of results) {
			messages.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.content });
		}
	}

	const finalResponse = await streamOpenAIMessages(apiKey, model, messages, onChunk);
	totalUsage = accumulateUsage(totalUsage, finalResponse.usage);
	return {
		text: (finalResponse.textContent || '') + TOOL_LIMIT_NOTICE,
		outcomes: allOutcomes,
		usage: totalUsage,
	};
};

const runClaudeLoop = async (
	apiKey: string,
	model: string,
	promptParts: SystemPromptParts,
	userPrompt: string,
	context: ActionContext,
	history?: ChatMessage[],
	noteContext?: NoteContextSnapshot,
): Promise<{ text: string; outcomes: AIActionOutcome[]; usage: TokenUsage }> => {
	const tools = getClaudeTools(context.workMode, context.kieApiKey);
	const historyMessages = (history ?? []).map((m) => ({ role: m.role, content: m.content }));
	const pdfParts = buildClaudePdfParts(context.attachedFiles ?? []);
	const imageParts = buildClaudeImageParts(context.attachedFiles ?? []);
	const mediaParts = [...pdfParts, ...imageParts];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const userMessage: any =
		mediaParts.length > 0
			? { role: 'user', content: [...mediaParts, { type: 'text', text: userPrompt }] }
			: { role: 'user', content: userPrompt };
	const noteContextPair =
		noteContext && noteContext.noteId === context.currentNoteId
			? [
					{
						role: 'user' as const,
						content: `[NOTE_CONTEXT]\nTitle: ${noteContext.noteTitle}\n\n${noteContext.noteBody}`,
					},
					{ role: 'assistant' as const, content: 'Note context received.' },
				]
			: [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const messages: any[] = [...noteContextPair, ...historyMessages, userMessage];
	const systemBlocks: import('./claude').ClaudeSystemBlock[] = [
		{ type: 'text', text: promptParts.staticInstructions, cache_control: { type: 'ephemeral' } },
		{ type: 'text', text: promptParts.noteBodyContext, cache_control: { type: 'ephemeral' } },
		...(promptParts.dynamicContext
			? [{ type: 'text' as const, text: promptParts.dynamicContext }]
			: []),
	];
	const allOutcomes: AIActionOutcome[] = [];
	let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
	const onChunk = context.onStreamChunk ?? (() => {});

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await streamClaudeMessages(
			apiKey,
			model,
			systemBlocks,
			messages,
			onChunk,
			tools,
		);
		totalUsage = accumulateUsage(totalUsage, response.usage);

		if (response.toolCalls.length === 0) {
			return { text: response.textContent || '', outcomes: allOutcomes, usage: totalUsage };
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

	const finalResponse = await streamClaudeMessages(apiKey, model, systemBlocks, messages, onChunk);
	totalUsage = accumulateUsage(totalUsage, finalResponse.usage);
	return {
		text: (finalResponse.textContent || '') + TOOL_LIMIT_NOTICE,
		outcomes: allOutcomes,
		usage: totalUsage,
	};
};

const runPerplexityLoop = async (
	apiKey: string,
	model: string,
	promptParts: SystemPromptParts,
	userPrompt: string,
	context: ActionContext,
	history?: ChatMessage[],
	nativeWebSearch = true,
	noteContext?: NoteContextSnapshot,
): Promise<{ text: string; outcomes: AIActionOutcome[]; usage: TokenUsage }> => {
	const systemPrompt =
		promptParts.staticInstructions + promptParts.noteBodyContext + promptParts.dynamicContext;
	const tools = getPerplexityTools(context.workMode, nativeWebSearch, context.kieApiKey);
	const noteContextItems: PerplexityInputItem[] =
		noteContext && noteContext.noteId === context.currentNoteId
			? [
					{
						role: 'user',
						content: `[NOTE_CONTEXT]\nTitle: ${noteContext.noteTitle}\n\n${noteContext.noteBody}`,
					},
					{ role: 'assistant', content: 'Note context received.' },
				]
			: [];
	const historyItems: PerplexityInputItem[] = (history ?? []).map((m) => ({
		role: m.role,
		content: m.content,
	}));
	let input: string | PerplexityInputItem[] =
		noteContextItems.length > 0 || historyItems.length > 0
			? [...noteContextItems, ...historyItems, { role: 'user', content: userPrompt }]
			: userPrompt;
	const allOutcomes: AIActionOutcome[] = [];
	let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await sendPerplexityRequest(apiKey, model, input, systemPrompt, tools);
		totalUsage = accumulateUsage(totalUsage, response.usage);

		if (response.toolCalls.length === 0) {
			return { text: response.textContent || '', outcomes: allOutcomes, usage: totalUsage };
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
	totalUsage = accumulateUsage(totalUsage, finalResponse.usage);
	return {
		text: (finalResponse.textContent || '') + TOOL_LIMIT_NOTICE,
		outcomes: allOutcomes,
		usage: totalUsage,
	};
};

const runSonarLoop = async (
	apiKey: string,
	model: string,
	promptParts: SystemPromptParts,
	userPrompt: string,
	context: ActionContext,
	history?: ChatMessage[],
	nativeWebSearch = true,
	noteContext?: NoteContextSnapshot,
): Promise<{ text: string; outcomes: AIActionOutcome[]; usage: TokenUsage }> => {
	const systemPrompt =
		promptParts.staticInstructions + promptParts.noteBodyContext + promptParts.dynamicContext;
	const tools = getPerplexityTools(context.workMode, nativeWebSearch, context.kieApiKey);
	const toolPrompt = buildSonarToolCallPrompt(tools);
	const enhancedSystemPrompt = systemPrompt + toolPrompt;
	const noteContextPair: SonarChatMessage[] =
		noteContext && noteContext.noteId === context.currentNoteId
			? [
					{
						role: 'user',
						content: `[NOTE_CONTEXT]\nTitle: ${noteContext.noteTitle}\n\n${noteContext.noteBody}`,
					},
					{ role: 'assistant', content: 'Note context received.' },
				]
			: [];
	const messages: SonarChatMessage[] = [
		{ role: 'system', content: enhancedSystemPrompt },
		...noteContextPair,
		...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
		{ role: 'user', content: userPrompt },
	];
	const allOutcomes: AIActionOutcome[] = [];
	let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		const response = await sendSonarChatRequest(apiKey, model, messages);
		totalUsage = accumulateUsage(totalUsage, response.usage);
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
					usage: totalUsage,
				};
			}
			return { text: cleanText || responseText, outcomes: allOutcomes, usage: totalUsage };
		}
		messages.push({ role: 'assistant', content: responseText });
		const { outcomes, results } = await runToolCalls(toolCalls, context);
		allOutcomes.push(...outcomes);
		const resultSummary = results.map((r) => r.content).join('\n');
		messages.push({ role: 'user', content: `[TOOL_RESULT]\n${resultSummary}\n[/TOOL_RESULT]` });
	}
	const finalResponse = await sendSonarChatRequest(apiKey, model, messages, context.onStreamChunk);
	totalUsage = accumulateUsage(totalUsage, finalResponse.usage);
	const finalText = finalResponse.textContent || '';
	const parsed = parseSonarToolCalls(finalText);
	return {
		text: (parsed.cleanText || finalText) + TOOL_LIMIT_NOTICE,
		outcomes: allOutcomes,
		usage: totalUsage,
	};
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
	tracker?: CostTracker,
	noteContext?: NoteContextSnapshot,
): Promise<AIResponse> => {
	validateApiKey(provider, apiKey);
	const actionContext: ActionContext = context ?? {
		currentNoteId: null,
		currentNoteTitle: noteTitle,
	};
	// workMode gate: only include note body in edit/ask modes; agent mode uses get_note on demand.
	const includeBody = actionContext.workMode === 'edit' || actionContext.workMode === 'ask';
	const promptParts = buildSystemPromptParts({
		noteTitle,
		noteId: actionContext.currentNoteId ?? undefined,
		noteBody: includeBody ? noteBody : '',
		notebooks: actionContext.notebooks,
		agentRolePrompt: actionContext.agentRolePrompt,
		workMode: actionContext.workMode,
		referencedNotes: actionContext.referencedNotes,
		attachedFiles: actionContext.attachedFiles,
		nativeWebSearch: provider === 'perplexity' && isPerplexityNativeModel(model),
		isSelection: actionContext.isSelection,
		selectionText: actionContext.selectionText,
		noteBodyOmitted: !includeBody,
		noteContextInHistory: includeBody ? noteContext : undefined,
		kieApiKey: actionContext.kieApiKey,
	});
	if (promptParts.diffStats) {
		actionContext.onDiffSent?.(promptParts.diffStats.added, promptParts.diffStats.removed);
	} else {
		actionContext.onBodyDecision?.(promptParts.bodyIncluded);
	}

	const ct = tracker ?? defaultCostTracker;
	const traceId = `trace-${Date.now()}`;
	const gen = ct.startGeneration(traceId, { name: `${provider}-chat`, model });
	const isNativeSearch = isPerplexityNativeModel(model);

	const runLoop = () => {
		if (provider === 'openai')
			return runOpenAILoop(apiKey, model, promptParts, userPrompt, actionContext, history, noteContext);
		if (provider === 'perplexity') {
			if (isSonarApiModel(model))
				return runSonarLoop(
					apiKey,
					model,
					promptParts,
					userPrompt,
					actionContext,
					history,
					isNativeSearch,
					noteContext,
				);
			return runPerplexityLoop(
				apiKey,
				model,
				promptParts,
				userPrompt,
				actionContext,
				history,
				isNativeSearch,
				noteContext,
			);
		}
		if (provider === 'claude') {
			return runClaudeLoop(apiKey, model, promptParts, userPrompt, actionContext, history, noteContext);
		}
		return runClaudeLoop(apiKey, model, promptParts, userPrompt, actionContext, history, noteContext);
	};
	const { text, outcomes, usage } = await runLoop();

	ct.endGeneration(gen, {
		output: text,
		usageDetails: { input: usage.inputTokens, output: usage.outputTokens },
	});
	const traceCost = ct.getTraceCost(traceId);

	const hasNoteUpdate = outcomes.some(
		(o) => (o.action === 'update_note' || o.action === 'patch_note') && o.success,
	);

	return {
		content: text,
		isEdit: hasNoteUpdate,
		editedBody: undefined,
		actions: outcomes,
		usage,
		costUsd: traceCost.total,
	};
};
