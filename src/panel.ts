import joplin from 'api';
import { ViewHandle } from 'api/types';
import { SETTING_KEYS } from './settings';
import { sendToAI, buildSystemPrompt } from './ai/service';
import { AIProvider, AgentRole, AIActionOutcome, ChatMessage, WorkMode } from './ai/types';
import { computeContextUsage } from './ai/context-size';
import { ActionContext, AttachedFile, Notebook, ReferencedNote } from './actions/types';
import { parseNoteReferences, stripNoteReferences } from './ai/note-refs';
import { extractPdfTextFromBase64 } from './utils/pdf-extract';
import { shareNoteAsText, buildPdfMailtoUrl, openUrlInSystem } from './utils/share-note';

let panelHandle: ViewHandle | null = null;
let panelVisible = false;
let blockEditorEnabled = false;
let editorSelection = '';

const PANEL_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
	<div id="app">
		<div class="ai-chat-pane">
			<div class="header">
				<div class="header-title">
					<span class="icon">&#x1F916;</span>
					AI Assistant
				</div>
				<div class="note-info" id="noteInfo">Loading...</div>
				<div class="role-bar" id="roleBar">
					<select id="roleSelect" class="role-select">
						<option value="">No role</option>
					</select>
					<button id="applyRoleBtn" class="btn btn-secondary btn-sm">Apply</button>
					<button id="manageRolesBtn" class="btn btn-secondary btn-sm">&#x2699; Roles</button>
				</div>
			</div>
			<div class="messages" id="messages">
				<div class="empty-state" id="emptyState">
					<div class="icon">&#x1F4AC;</div>
					<p>Ask a question about your note or request edits.<br>The current note is shared as context.</p>
				</div>
			</div>
			<div id="queueContainer" class="queue-container"></div>
			<div class="input-area">
				<div class="input-container">
					<div id="fileChips" class="file-chips"></div>
					<div class="textarea-wrap">
						<textarea
							id="promptInput"
							class="prompt-input"
							placeholder="What would you like to do with this note?"
							rows="2"
						></textarea>
					</div>
					<div class="bottom-bar">
						<div class="bottom-bar-left">
							<div class="mode-pill-wrap">
								<select id="modeSelect" class="mode-pill-select">
									<option value="ask">&#x1F4AC; Ask</option>
									<option value="agent" selected>&#x1F916; Agent</option>
									<option value="edit">&#x270F; Edit</option>
								</select>
							</div>
							<button id="attachFileBtn" class="icon-btn" title="Attach file">&#x1F4CE;</button>
							<button id="clearBtn" class="icon-btn" title="Clear input">&#x2715;</button>
						</div>
						<div class="bottom-bar-right">
							<div id="contextSizeContainer" class="context-size-container"></div>
							<button id="clearHistoryBtn" class="icon-btn" title="Clear history">&#x1F9F9;</button>
							<button id="executeBtn" class="btn send-btn" title="Send (Enter)">&#x27A4;</button>
						</div>
					</div>
				</div>
				<input type="file" id="fileInput" style="display:none" multiple accept=".pdf,.txt,.md,.csv,.json,.xml,.js,.ts,.py,.java,.c,.cpp,.h,.html,.css,.yaml,.yml,.toml,.ini,.cfg,.log,.sh,.bat,.sql,.r,.rb,.go,.rs,.swift,.kt,.scala,.lua,.pl,.php" />
			</div>
			<div id="roleManageView" class="role-manage-view" style="display: none;"></div>
		</div>
		<div id="editor-resizer" style="display: none;"></div>
		<div id="editor-pane" style="display: none;">
			<div id="editor-container" tabindex="-1"></div>
			<div id="slash-menu"></div>
			<div id="vim-statusbar" data-mode="insert">
				<span id="vim-mode-label">INSERT</span>
			</div>
		</div>
	</div>
</body>
</html>`;

const getCurrentNote = async (): Promise<{ id: string; title: string; body: string } | null> => {
	const note = await joplin.workspace.selectedNote();
	if (!note) return null;
	const full = await joplin.data.get(['notes', note.id], { fields: ['id', 'title', 'body'] });
	return full;
};

const resolveNoteReferences = async (titles: string[]): Promise<ReferencedNote[]> => {
	const searchResults = await Promise.all(
		titles.map((title) =>
			joplin.data.get(['search'], {
				query: `title:"${title.replace(/"/g, '')}"`,
				fields: ['id', 'title', 'parent_id'],
				limit: 1,
			}),
		),
	);
	const noteIds = searchResults
		.map((r) => ((r.items || []) as Array<{ id: string; title: string }>)[0])
		.filter(Boolean);
	const fullNotes = await Promise.all(
		noteIds.map((n) => joplin.data.get(['notes', n.id], { fields: ['id', 'title', 'body'] })),
	);
	return fullNotes.filter(Boolean).map((n) => ({ id: n.id, title: n.title, body: n.body }));
};

const sanitizeSearchQuery = (query: string): string => query.replace(/[":*\-\\]/g, ' ').trim();

const searchNotesByQuery = async (handle: ViewHandle, query: string): Promise<void> => {
	const sanitized = sanitizeSearchQuery(query);
	if (!sanitized) return;
	const results = await joplin.data.get(['search'], {
		query: `title:*${sanitized}*`,
		fields: ['id', 'title'],
		limit: 10,
	});
	const notes = ((results.items || []) as Array<{ id: string; title: string }>).map((n) => ({
		id: n.id,
		title: n.title,
	}));
	joplin.views.panels.postMessage(handle, { type: 'noteSearchResults', notes });
};

const MODEL_DISPLAY_NAMES: Record<string, string> = {
	'gpt-4o': 'GPT-4o',
	'gpt-4o-mini': 'GPT-4o Mini',
	'gpt-4-turbo': 'GPT-4 Turbo',
	'gpt-3.5-turbo': 'GPT-3.5 Turbo',
	'codex-mini-latest': 'Codex Mini',
	'claude-opus-4-20250514': 'Claude Opus 4',
	'claude-sonnet-4-20250514': 'Claude Sonnet 4',
	'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
	'claude-3-haiku-20240307': 'Claude 3 Haiku',
	sonar: 'Sonar',
	'sonar-pro': 'Sonar Pro',
	'sonar-reasoning-pro': 'Sonar Reasoning Pro',
	'sonar-deep-research': 'Sonar Deep Research',
};

const getModelDisplayName = (modelId: string): string => MODEL_DISPLAY_NAMES[modelId] ?? modelId;

const getModelFromSettings = async (): Promise<string> => {
	const settings = await joplin.settings.values([
		SETTING_KEYS.provider,
		SETTING_KEYS.openaiModel,
		SETTING_KEYS.claudeModel,
		SETTING_KEYS.perplexityModel,
	]);
	const provider = (settings[SETTING_KEYS.provider] as string) ?? 'openai';
	if (provider === 'perplexity') return settings[SETTING_KEYS.perplexityModel] as string;
	return provider === 'openai'
		? (settings[SETTING_KEYS.openaiModel] as string)
		: (settings[SETTING_KEYS.claudeModel] as string);
};

const sendContextSize = async (
	handle: ViewHandle,
	note: { title: string; body: string } | null,
) => {
	const model = await getModelFromSettings();
	const systemPrompt = buildSystemPrompt({
		noteTitle: note?.title ?? '',
		noteBody: note?.body ?? '',
	});
	const usage = computeContextUsage({
		systemPrompt,
		history: [],
		userPrompt: '',
		model,
	});
	joplin.views.panels.postMessage(handle, {
		type: 'contextSize',
		usedTokens: usage.usedTokens,
		maxTokens: usage.maxTokens,
		percentage: usage.percentage,
	});
};

const sendNoteInfo = async (handle: ViewHandle) => {
	const note = await getCurrentNote();
	joplin.views.panels.postMessage(handle, {
		type: 'noteInfo',
		title: note ? note.title : null,
	});
	await sendContextSize(handle, note);
};

const sendAgentRoles = async (handle: ViewHandle) => {
	const raw = (await joplin.settings.value(SETTING_KEYS.agentRoles)) as string;
	let roles: AgentRole[] = [];
	try {
		const parsed = raw ? JSON.parse(raw) : [];
		roles = Array.isArray(parsed) ? parsed : [];
	} catch {
		roles = [];
	}
	joplin.views.panels.postMessage(handle, { type: 'agentRoles', roles });
};

const saveAgentRoles = async (handle: ViewHandle, roles: AgentRole[]) => {
	await joplin.settings.setValue(SETTING_KEYS.agentRoles, JSON.stringify(roles));
	joplin.views.panels.postMessage(handle, { type: 'agentRoles', roles });
};

interface ProviderConfig {
	provider: AIProvider;
	apiKey: string;
	model: string;
	webSearchEnabled: boolean;
	webSearchModel: string;
	openaiApiKey: string;
	perplexityApiKey: string;
	kieApiKey?: string;
	imageGenModel?: string;
}

const loadProviderConfig = async (): Promise<ProviderConfig> => {
	const settings = await joplin.settings.values([
		SETTING_KEYS.provider,
		SETTING_KEYS.openaiKey,
		SETTING_KEYS.openaiModel,
		SETTING_KEYS.claudeKey,
		SETTING_KEYS.claudeModel,
		SETTING_KEYS.perplexityKey,
		SETTING_KEYS.perplexityModel,
		SETTING_KEYS.webSearchEnabled,
		SETTING_KEYS.webSearchModel,
		SETTING_KEYS.kieApiKey,
		SETTING_KEYS.imageGenModel,
	]);
	const provider = (settings[SETTING_KEYS.provider] as AIProvider) ?? 'openai';
	const apiKeyMap: Record<string, string> = {
		openai: settings[SETTING_KEYS.openaiKey] as string,
		claude: settings[SETTING_KEYS.claudeKey] as string,
		perplexity: settings[SETTING_KEYS.perplexityKey] as string,
	};
	const modelMap: Record<string, string> = {
		openai: settings[SETTING_KEYS.openaiModel] as string,
		claude: settings[SETTING_KEYS.claudeModel] as string,
		perplexity: settings[SETTING_KEYS.perplexityModel] as string,
	};
	return {
		provider,
		apiKey: apiKeyMap[provider] ?? '',
		model: modelMap[provider] ?? '',
		webSearchEnabled: !!settings[SETTING_KEYS.webSearchEnabled],
		webSearchModel:
			(settings[SETTING_KEYS.webSearchModel] as string) || 'openai:gpt-4o-search-preview',
		openaiApiKey: settings[SETTING_KEYS.openaiKey] as string,
		perplexityApiKey: settings[SETTING_KEYS.perplexityKey] as string,
		kieApiKey: (settings[SETTING_KEYS.kieApiKey] as string) || undefined,
		imageGenModel: (settings[SETTING_KEYS.imageGenModel] as string) || undefined,
	};
};

const fetchNotebooks = async (): Promise<Notebook[]> => {
	const foldersResult = await joplin.data.get(['folders'], {
		fields: ['id', 'title'],
	});
	return ((foldersResult.items || []) as Array<{ id: string; title: string }>).map((f) => ({
		id: f.id,
		title: f.title,
	}));
};

const sendResult = (
	handle: ViewHandle,
	response: { isEdit: boolean; content: string; actions: AIActionOutcome[] },
	model: string,
) => {
	joplin.views.panels.postMessage(handle, {
		type: 'result',
		isEdit: response.isEdit,
		content: response.content,
		actions: response.actions,
		modelName: getModelDisplayName(model),
	});
};

const sendUpdatedContextSize = (
	handle: ViewHandle,
	opts: {
		note: { title: string; body: string };
		notebooks: Notebook[];
		agentRolePrompt?: string;
		workMode?: WorkMode;
		referencedNotes: ReferencedNote[];
		attachedFiles?: AttachedFile[];
		history: ChatMessage[];
		userPrompt: string;
		model: string;
	},
) => {
	const systemPrompt = buildSystemPrompt({
		noteTitle: opts.note.title,
		noteBody: opts.note.body,
		notebooks: opts.notebooks,
		agentRolePrompt: opts.agentRolePrompt,
		workMode: opts.workMode,
		referencedNotes: opts.referencedNotes,
		attachedFiles: opts.attachedFiles,
	});
	const usage = computeContextUsage({
		systemPrompt,
		history: opts.history,
		userPrompt: opts.userPrompt,
		model: opts.model,
	});
	joplin.views.panels.postMessage(handle, {
		type: 'contextSize',
		usedTokens: usage.usedTokens,
		maxTokens: usage.maxTokens,
		percentage: usage.percentage,
	});
};

interface PromptContext {
	notebooks: Notebook[];
	referencedNotes: ReferencedNote[];
	cleanPrompt: string;
}

const resolvePromptContext = async (prompt: string): Promise<PromptContext> => {
	const notebooks = await fetchNotebooks();
	const refTitles = parseNoteReferences(prompt);
	const referencedNotes = refTitles.length > 0 ? await resolveNoteReferences(refTitles) : [];
	const cleanPrompt = stripNoteReferences(prompt);
	return { notebooks, referencedNotes, cleanPrompt };
};

const handleExecute = async (
	handle: ViewHandle,
	prompt: string,
	history?: ChatMessage[],
	agentRolePrompt?: string,
	workMode?: WorkMode,
	attachedFiles?: AttachedFile[],
) => {
	try {
		const config = await loadProviderConfig();
		if (!config.apiKey?.trim()) {
			joplin.views.panels.postMessage(handle, {
				type: 'alert',
				message: `API key for ${config.provider} is not configured. Go to Settings → AI Assistant to set it up.`,
			});
			return;
		}
		const note = await getCurrentNote();
		if (!note) {
			joplin.views.panels.postMessage(handle, {
				type: 'error',
				message: 'No note is currently selected. Please select a note first.',
			});
			return;
		}
		const { notebooks, referencedNotes, cleanPrompt } = await resolvePromptContext(prompt);
		const onImageProgress = (info: { progress: number; state: string }) => {
			joplin.views.panels.postMessage(handle, {
				type: 'imageProgress',
				progress: info.progress,
				state: info.state,
			});
		};
		const onThinkingStep = (info: { step: string; label: string }) => {
			joplin.views.panels.postMessage(handle, {
				type: 'thinkingStep',
				step: info.step,
				label: info.label,
			});
		};
		if (attachedFiles?.length) {
			await Promise.all(
				attachedFiles
					.filter((f) => f.base64Data && f.mimeType === 'application/pdf')
					.map(async (f) => {
						try {
							const text = await extractPdfTextFromBase64(f.base64Data!);
							if (text.trim()) {
								f.content = text;
								f.base64Data = undefined;
							}
						} catch {
							/* keep base64Data for LLM multimodal fallback */
						}
					}),
			);
		}
		const isPerplexityPrimary = config.provider === 'perplexity';
		const context: ActionContext = {
			currentNoteId: note.id,
			currentNoteTitle: note.title,
			notebooks,
			referencedNotes,
			attachedFiles: attachedFiles?.length ? attachedFiles : undefined,
			agentRolePrompt: agentRolePrompt || undefined,
			workMode: workMode || ('agent' as WorkMode),
			webSearchEnabled: config.webSearchEnabled && !isPerplexityPrimary,
			webSearchModel: config.webSearchModel,
			openaiApiKey: config.openaiApiKey,
			perplexityApiKey: config.perplexityApiKey,
			kieApiKey: config.kieApiKey,
			imageGenModel: config.imageGenModel,
			onImageProgress,
			onThinkingStep,
		};
		const response = await sendToAI(
			config.provider,
			config.apiKey,
			config.model,
			cleanPrompt,
			note.title,
			note.body,
			context,
			history,
		);
		sendResult(handle, response, config.model);
		sendUpdatedContextSize(handle, {
			note,
			notebooks,
			agentRolePrompt,
			workMode,
			referencedNotes,
			attachedFiles,
			history: history ?? [],
			userPrompt: cleanPrompt,
			model: config.model,
		});
		if (response.isEdit) {
			await sendNoteInfo(handle);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		joplin.views.panels.postMessage(handle, {
			type: 'error',
			message: message,
		});
	}
};

export const initPanel = async () => {
	panelHandle = await joplin.views.panels.create('aiAssistantPanel');
	await joplin.views.panels.setHtml(panelHandle, PANEL_HTML);
	await joplin.views.panels.addScript(panelHandle, './webview/panel.css');
	await joplin.views.panels.addScript(panelHandle, './webview/markdown.js');
	await joplin.views.panels.addScript(panelHandle, './webview/pdf-parser.js');
	// EditorJS vendor bundles must load before block-editor.js so that the
	// expected window globals (EditorJS, Header, …) are already defined.
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/editorjs.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/header.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/editorjs-list.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/checklist.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/code.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/quote.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/delimiter.umd.js');
	await joplin.views.panels.addScript(panelHandle, './webview/vendor/editorjs-drag-drop.js');
	await joplin.views.panels.addScript(panelHandle, './webview/markdown-converter.js');
	await joplin.views.panels.addScript(panelHandle, './webview/panel.js');
	await joplin.views.panels.addScript(panelHandle, './webview/block-editor.js');
	await joplin.views.panels.hide(panelHandle);
	panelVisible = false;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await joplin.views.panels.onMessage(panelHandle, async (message: any) => {
		if (!panelHandle) return;

		if (message.type === 'abortRequest') {
			return;
		}

		if (message.type === 'saveBlocks') {
			const { noteId, markdown } = message as { noteId: unknown; markdown: unknown };
			if (noteId && typeof markdown === 'string') {
				try {
					await joplin.data.put(['notes', noteId as string], null, { body: markdown });
				} catch (_) {}
			}
			return;
		}

		if (message.type === 'execute') {
			await handleExecute(
				panelHandle,
				message.prompt,
				message.history as ChatMessage[],
				message.agentRolePrompt as string | undefined,
				message.workMode as WorkMode | undefined,
				message.attachedFiles as AttachedFile[] | undefined,
			);
		}

		if (message.type === 'getNote') {
			await sendNoteInfo(panelHandle);
		}

		if (message.type === 'searchNotes') {
			await searchNotesByQuery(panelHandle, message.query as string);
		}

		if (message.type === 'getFileSizeLimit') {
			const sizeMb = ((await joplin.settings.value(SETTING_KEYS.fileMaxSizeMb)) as number) || 10;
			joplin.views.panels.postMessage(panelHandle, {
				type: 'fileSizeLimit',
				limitBytes: sizeMb * 1024 * 1024,
			});
		}

		if (message.type === 'getAgentRoles') {
			await sendAgentRoles(panelHandle);
		}

		if (message.type === 'saveAgentRoles') {
			await saveAgentRoles(panelHandle, message.roles as AgentRole[]);
		}
	});

	await joplin.workspace.onNoteSelectionChange(async () => {
		if (panelHandle && panelVisible) {
			await sendNoteInfo(panelHandle);
		}
	});
};

export const togglePanel = async () => {
	if (!panelHandle) return;
	panelVisible = !panelVisible;
	if (panelVisible) {
		await joplin.views.panels.show(panelHandle);
		await sendNoteInfo(panelHandle);
	} else {
		await joplin.views.panels.hide(panelHandle);
	}
};

export const getBlockEditorEnabled = (): boolean => blockEditorEnabled;

export const setEditorSelection = (text: string): void => {
	editorSelection = text;
};

/**
 * Toggles the block editor pane and notifies the webview of the new state.
 * Shows the panel if it is currently hidden so the block editor is visible.
 * The editorHider content script polls this state to hide/show the native CM editor.
 */
export const toggleBlockEditorPane = async (): Promise<void> => {
	blockEditorEnabled = !blockEditorEnabled;
	if (!panelHandle) return;
	if (blockEditorEnabled && !panelVisible) {
		panelVisible = true;
		await joplin.views.panels.show(panelHandle);
		await sendNoteInfo(panelHandle);
	}
	joplin.views.panels.postMessage(panelHandle, {
		type: 'blockEditorState',
		active: blockEditorEnabled,
	});
};

/**
 * Shares the currently selected note via email.
 *
 * - 'pdf'  → delegates to Joplin's built-in exportPdf command which opens the
 *             native OS save dialog and renders the note via Chromium print-to-PDF,
 *             then opens the default email client with the subject pre-filled.
 * - 'text' → converts the note body to structured plain text and opens the
 *             email client with the full content in the message body.
 */
export const shareCurrentNote = async (format: string): Promise<void> => {
	const note = await getCurrentNote();
	if (!note) throw new Error('No note selected. Please open a note first.');
	if (format === 'pdf') {
		await joplin.commands.execute('exportPdf', [note.id]);
		await openUrlInSystem(buildPdfMailtoUrl(note.title));
	} else {
		await shareNoteAsText({ title: note.title, body: note.body });
	}
};
