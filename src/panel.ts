import joplin from 'api';
import { ViewHandle } from 'api/types';
import {
	SETTING_KEYS,
	PROVIDER_OPTIONS,
	OPENAI_MODEL_OPTIONS,
	CLAUDE_MODEL_OPTIONS,
	PERPLEXITY_MODEL_OPTIONS,
	WEB_SEARCH_MODEL_OPTIONS,
	IMAGE_GEN_MODEL_OPTIONS,
	ALLOWED_SETTING_KEYS,
} from './settings';
import { sendToAI, buildSystemPrompt } from './ai/service';
import { isPerplexityNativeModel } from './ai/perplexity';
import { AIProvider, AgentRole, AIActionOutcome, ChatMessage, WorkMode } from './ai/types';
import { computeContextUsage } from './ai/context-size';
import { ActionContext, AttachedFile, Notebook, ReferencedNote } from './actions/types';
import { parseNoteReferences, stripNoteReferences } from './ai/note-refs';
import { extractPdfTextFromBase64 } from './utils/pdf-extract';
import { shareNoteAsText, exportNoteWithPandoc, copyFileToDirectory } from './utils/share-note';

let chatPanelHandle: ViewHandle | null = null;
let editorPanelHandle: ViewHandle | null = null;
let chatPanelVisible = false;
let editorPanelVisible = false;
let editorSelection = '';

const CHAT_PANEL_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
	<div id="app">
		<div class="ai-chat-pane">
			<div class="header">
				<div class="header-title">
					<span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><line x1="8" y1="16" x2="8" y2="16.01"/><line x1="16" y1="16" x2="16" y2="16.01"/></svg></span>
					AI Assistant
					<button id="settingsBtn" class="icon-btn header-settings-btn" title="AI Settings"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
				</div>
				<div class="note-info" id="noteInfo">Loading...</div>
				<div class="role-bar" id="roleBar">
					<select id="roleSelect" class="role-select">
						<option value="">No role</option>
					</select>
					<button id="applyRoleBtn" class="btn btn-secondary btn-sm">Apply</button>
					<button id="manageRolesBtn" class="btn btn-secondary btn-sm"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Roles</button>
				</div>
			</div>
			<div class="messages" id="messages">
				<div class="empty-state" id="emptyState">
					<div class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></div>
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
									<option value="ask">Ask</option>
									<option value="agent" selected>Agent</option>
									<option value="edit">Edit</option>
								</select>
							</div>
							<button id="attachFileBtn" class="icon-btn" title="Attach file"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
							<button id="clearBtn" class="icon-btn" title="Clear input"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
						</div>
						<div class="bottom-bar-right">
							<div id="contextSizeContainer" class="context-size-container"></div>
							<button id="clearHistoryBtn" class="icon-btn" title="Clear history"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
							<button id="executeBtn" class="btn send-btn" title="Send (Enter)"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
						</div>
					</div>
				</div>
				<input type="file" id="fileInput" style="display:none" multiple accept=".pdf,.txt,.md,.csv,.json,.xml,.js,.ts,.py,.java,.c,.cpp,.h,.html,.css,.yaml,.yml,.toml,.ini,.cfg,.log,.sh,.bat,.sql,.r,.rb,.go,.rs,.swift,.kt,.scala,.lua,.pl,.php" />
			</div>
			<div id="roleManageView" class="role-manage-view" style="display: none;"></div>
			<div id="settingsManageView" class="settings-manage-view" style="display: none;"></div>
		</div>
	</div>
</body>
</html>`;

const EDITOR_PANEL_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
	<div id="app">
		<div id="editor-container" tabindex="-1"></div>
		<div id="vim-statusbar" data-mode="insert">
			<span id="vim-mode-label">INSERT</span>
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

const getNoteById = async (
	noteId: string,
): Promise<{ id: string; title: string; body: string } | null> => {
	try {
		const note = await joplin.data.get(['notes', noteId], { fields: ['id', 'title', 'body'] });
		return note ?? null;
	} catch {
		return null;
	}
};

const sendNoteInfo = async (handle: ViewHandle) => {
	const note = await getCurrentNote();
	joplin.views.panels.postMessage(handle, {
		type: 'noteInfo',
		noteId: note ? note.id : null,
		title: note ? note.title : null,
		bodyLength: note ? note.body.length : 0,
	});
	await sendContextSize(handle, note);
};

const sendNoteLoaded = async (handle: ViewHandle) => {
	const note = await getCurrentNote();
	if (!note) return;
	joplin.views.panels.postMessage(handle, {
		type: 'noteLoaded',
		note: { id: note.id, title: note.title, body: note.body },
	});
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

const sendSettings = async (handle: ViewHandle) => {
	const vals = await joplin.settings.values([
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
		SETTING_KEYS.fileMaxSizeMb,
	]);
	joplin.views.panels.postMessage(handle, {
		type: 'settingsData',
		provider: vals[SETTING_KEYS.provider] ?? 'openai',
		openaiModel: vals[SETTING_KEYS.openaiModel] ?? 'gpt-4o',
		claudeModel: vals[SETTING_KEYS.claudeModel] ?? 'claude-sonnet-4-20250514',
		perplexityModel: vals[SETTING_KEYS.perplexityModel] ?? 'sonar',
		webSearchEnabled: !!vals[SETTING_KEYS.webSearchEnabled],
		webSearchModel: vals[SETTING_KEYS.webSearchModel] ?? 'openai:gpt-4o-search-preview',
		imageGenModel: vals[SETTING_KEYS.imageGenModel] ?? 'gpt-image/1.5-text-to-image',
		fileMaxSizeMb: vals[SETTING_KEYS.fileMaxSizeMb] ?? 10,
		openaiKeySet: !!((vals[SETTING_KEYS.openaiKey] as string) ?? '').trim(),
		claudeKeySet: !!((vals[SETTING_KEYS.claudeKey] as string) ?? '').trim(),
		perplexityKeySet: !!((vals[SETTING_KEYS.perplexityKey] as string) ?? '').trim(),
		kieKeySet: !!((vals[SETTING_KEYS.kieApiKey] as string) ?? '').trim(),
		providerOptions: PROVIDER_OPTIONS,
		openaiModelOptions: OPENAI_MODEL_OPTIONS,
		claudeModelOptions: CLAUDE_MODEL_OPTIONS,
		perplexityModelOptions: PERPLEXITY_MODEL_OPTIONS,
		webSearchModelOptions: WEB_SEARCH_MODEL_OPTIONS,
		imageGenModelOptions: IMAGE_GEN_MODEL_OPTIONS,
	});
};

const handleSaveSettings = async (handle: ViewHandle, settings: Record<string, unknown>) => {
	const entries = Object.entries(settings).filter(([key]) => ALLOWED_SETTING_KEYS.has(key));
	await Promise.all(entries.map(([key, value]) => joplin.settings.setValue(key, value)));
	await sendSettings(handle);
	const note = await getCurrentNote();
	await sendContextSize(handle, note);
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
	return ((foldersResult?.items || []) as Array<{ id: string; title: string }>).map((f) => ({
		id: f.id,
		title: f.title,
	}));
};

const formatCostUsd = (cost?: number): string | null => {
	if (cost === undefined || cost === null) return null;
	if (cost < 0.001) return `< $0.001`;
	return `$${cost.toFixed(4)}`;
};

const sendResult = (
	handle: ViewHandle,
	response: {
		isEdit: boolean;
		content: string;
		actions: AIActionOutcome[];
		usage?: { inputTokens: number; outputTokens: number };
		costUsd?: number;
	},
	model: string,
) => {
	joplin.views.panels.postMessage(handle, {
		type: 'result',
		isEdit: response.isEdit,
		content: response.content,
		actions: response.actions,
		modelName: getModelDisplayName(model),
		usage: response.usage ?? null,
		costLabel: formatCostUsd(response.costUsd),
		costUsd: response.costUsd ?? null,
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
	noteId?: string,
) => {
	try {
		const [config, note, promptContext] = await Promise.all([
			loadProviderConfig(),
			noteId ? getNoteById(noteId) : getCurrentNote(),
			resolvePromptContext(prompt),
		]);
		if (!config.apiKey?.trim()) {
			joplin.views.panels.postMessage(handle, {
				type: 'alert',
				message: `API key for ${config.provider} is not configured. Go to Settings → AI Assistant to set it up.`,
			});
			return;
		}
		if (!note) {
			joplin.views.panels.postMessage(handle, {
				type: 'error',
				message: 'No note is currently selected. Please select a note first.',
			});
			return;
		}
		const { notebooks, referencedNotes, cleanPrompt } = promptContext;
		joplin.views.panels.postMessage(handle, {
			type: 'thinkingModel',
			modelName: getModelDisplayName(config.model),
		});
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
		const onStreamChunk = (text: string) => {
			joplin.views.panels.postMessage(handle, {
				type: 'streamChunk',
				text,
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
		const hasSelection = editorSelection.trim().length > 0;
		const noteBodyForAI = hasSelection ? editorSelection : note.body;
		const isNativePerplexitySearch =
			config.provider === 'perplexity' && isPerplexityNativeModel(config.model);
		const context: ActionContext = {
			currentNoteId: note.id,
			currentNoteTitle: note.title,
			notebooks,
			referencedNotes,
			attachedFiles: attachedFiles?.length ? attachedFiles : undefined,
			agentRolePrompt: agentRolePrompt || undefined,
			workMode: workMode || ('agent' as WorkMode),
			webSearchEnabled: config.webSearchEnabled && !isNativePerplexitySearch,
			webSearchModel: config.webSearchModel,
			openaiApiKey: config.openaiApiKey,
			perplexityApiKey: config.perplexityApiKey,
			kieApiKey: config.kieApiKey,
			imageGenModel: config.imageGenModel,
			onImageProgress,
			onThinkingStep,
			onStreamChunk,
			isSelection: hasSelection || undefined,
		};
		const response = await sendToAI(
			config.provider,
			config.apiKey,
			config.model,
			cleanPrompt,
			note.title,
			noteBodyForAI,
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
	chatPanelVisible = false;
	editorPanelVisible = false;
	editorSelection = '';

	chatPanelHandle = await joplin.views.panels.create('aiChatPanel');
	await joplin.views.panels.setHtml(chatPanelHandle, CHAT_PANEL_HTML);
	await joplin.views.panels.addScript(chatPanelHandle, './webview/panel.css');
	await joplin.views.panels.addScript(chatPanelHandle, './webview/icons.js');
	await joplin.views.panels.addScript(chatPanelHandle, './webview/markdown.js');
	await joplin.views.panels.addScript(chatPanelHandle, './webview/pdf-parser.js');
	await joplin.views.panels.addScript(chatPanelHandle, './webview/panel.js');
	await joplin.views.panels.hide(chatPanelHandle);

	editorPanelHandle = await joplin.views.panels.create('blockEditorPanel');
	await joplin.views.panels.setHtml(editorPanelHandle, EDITOR_PANEL_HTML);
	await joplin.views.panels.addScript(editorPanelHandle, './webview/panel.css');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/vendor/editorjs.umd.js');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/vendor/header.umd.js');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/vendor/editorjs-list.umd.js');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/vendor/checklist.umd.js');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/vendor/code.umd.js');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/vendor/quote.umd.js');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/vendor/delimiter.umd.js');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/vendor/editorjs-drag-drop.js');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/markdown-converter.js');
	await joplin.views.panels.addScript(editorPanelHandle, './webview/block-editor.js');
	await joplin.views.panels.hide(editorPanelHandle);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await joplin.views.panels.onMessage(chatPanelHandle, async (message: any) => {
		if (!chatPanelHandle) return;

		if (message.type === 'abortRequest') {
			return;
		}

		if (message.type === 'execute') {
			await handleExecute(
				chatPanelHandle,
				message.prompt,
				message.history as ChatMessage[],
				message.agentRolePrompt as string | undefined,
				message.workMode as WorkMode | undefined,
				message.attachedFiles as AttachedFile[] | undefined,
				message.noteId as string | undefined,
			);
		}

		if (message.type === 'getNote') {
			await sendNoteInfo(chatPanelHandle);
		}

		if (message.type === 'searchNotes') {
			await searchNotesByQuery(chatPanelHandle, message.query as string);
		}

		if (message.type === 'getFileSizeLimit') {
			const sizeMb = ((await joplin.settings.value(SETTING_KEYS.fileMaxSizeMb)) as number) || 10;
			joplin.views.panels.postMessage(chatPanelHandle, {
				type: 'fileSizeLimit',
				limitBytes: sizeMb * 1024 * 1024,
			});
		}

		if (message.type === 'getAgentRoles') {
			await sendAgentRoles(chatPanelHandle);
		}

		if (message.type === 'saveAgentRoles') {
			await saveAgentRoles(chatPanelHandle, message.roles as AgentRole[]);
		}

		if (message.type === 'getSettings') {
			await sendSettings(chatPanelHandle);
		}

		if (message.type === 'saveSettings') {
			await handleSaveSettings(
				chatPanelHandle,
				(message.settings as Record<string, unknown>) ?? {},
			);
		}
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await joplin.views.panels.onMessage(editorPanelHandle, async (message: any) => {
		if (!editorPanelHandle) return;

		if (message.type === 'getNote') {
			await sendNoteLoaded(editorPanelHandle);
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
	});

	await joplin.workspace.onNoteSelectionChange(async () => {
		if (chatPanelHandle && chatPanelVisible) {
			await sendNoteInfo(chatPanelHandle);
		}
		if (editorPanelHandle && editorPanelVisible) {
			await sendNoteLoaded(editorPanelHandle);
		}
	});
};

export const togglePanel = async (): Promise<void> => {
	if (!chatPanelHandle) return;
	chatPanelVisible = !chatPanelVisible;
	if (chatPanelVisible) {
		await joplin.views.panels.show(chatPanelHandle);
		await sendNoteInfo(chatPanelHandle);
	} else {
		await joplin.views.panels.hide(chatPanelHandle);
	}
};

export const getBlockEditorEnabled = (): boolean => editorPanelVisible;

export const setEditorSelection = (text: string): void => {
	editorSelection = text;
	if (chatPanelHandle && chatPanelVisible) {
		const trimmed = text.trim();
		joplin.views.panels.postMessage(chatPanelHandle, {
			type: 'selectionInfo',
			hasSelection: trimmed.length > 0,
			length: trimmed.length,
		});
	}
};

/**
 * Opens the AI chat panel (if hidden), sets the editor selection, and sends
 * a `triggerAskAI` message so the chat webview focuses on the selected text.
 * Ignores empty / whitespace-only input.
 */
export const triggerAskAI = async (text: string): Promise<void> => {
	if (!chatPanelHandle || !text.trim()) return;
	if (!chatPanelVisible) {
		chatPanelVisible = true;
		await joplin.views.panels.show(chatPanelHandle);
		await sendNoteInfo(chatPanelHandle);
	}
	setEditorSelection(text);
	joplin.views.panels.postMessage(chatPanelHandle, {
		type: 'triggerAskAI',
		text,
	});
};

export const toggleBlockEditorPane = async (): Promise<void> => {
	if (!editorPanelHandle) return;
	editorPanelVisible = !editorPanelVisible;
	if (editorPanelVisible) {
		await joplin.views.panels.show(editorPanelHandle);
		await sendNoteLoaded(editorPanelHandle);
	} else {
		await joplin.views.panels.hide(editorPanelHandle);
	}
};

/**
 * Prompts the user to pick a destination folder, then copies the exported file there.
 * Does nothing if the user cancels the dialog.
 */
const saveExportedFile = async (tempPath: string): Promise<void> => {
	const paths: string[] = await joplin.views.dialogs.showOpenDialog({
		properties: ['openDirectory', 'createDirectory'],
	});
	if (!paths || !paths.length) return;
	await copyFileToDirectory(tempPath, paths[0]);
};

/**
 * Exports or shares the currently selected note.
 *
 * - 'text' → converts markdown to plain text and opens a mailto: URL.
 * - 'pdf'  → triggers Joplin's built-in PDF export dialog.
 * - 'doc'  → converts markdown to DOCX via pandoc, then saves to a user-chosen folder.
 * - 'rtf'  → converts markdown to RTF via pandoc, then saves to a user-chosen folder.
 */
export const shareCurrentNote = async (format: string): Promise<void> => {
	const note = await getCurrentNote();
	if (!note) throw new Error('No note selected. Please open a note first.');
	if (format === 'text') {
		await shareNoteAsText({ title: note.title, body: note.body });
	} else if (format === 'pdf') {
		await joplin.commands.execute('exportPdf', [note.id]);
	} else if (format === 'doc') {
		const outputPath = await exportNoteWithPandoc({
			title: note.title,
			body: note.body,
			format: 'docx',
		});
		await saveExportedFile(outputPath);
	} else if (format === 'rtf') {
		const outputPath = await exportNoteWithPandoc({
			title: note.title,
			body: note.body,
			format: 'rtf',
		});
		await saveExportedFile(outputPath);
	}
};
