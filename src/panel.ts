import joplin from 'api';
import { ViewHandle } from 'api/types';
import { SETTING_KEYS } from './settings';
import { sendToAI } from './ai/service';
import { AIProvider } from './ai/types';

let panelHandle: ViewHandle | null = null;
let panelVisible = false;

const PANEL_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
	<div id="app">
		<div class="header">
			<div class="header-title">
				<span class="icon">&#x1F916;</span>
				AI Assistant
			</div>
			<div class="note-info" id="noteInfo">Loading...</div>
		</div>
		<div class="messages" id="messages">
			<div class="empty-state" id="emptyState">
				<div class="icon">&#x1F4AC;</div>
				<p>Ask a question about your note or request edits.<br>The current note is shared as context.</p>
			</div>
		</div>
		<div class="input-area">
			<div class="textarea-wrap">
				<textarea
					id="promptInput"
					class="prompt-input"
					placeholder="What would you like to do with this note?"
					rows="2"
				></textarea>
			</div>
			<div class="actions">
				<button id="executeBtn" class="btn btn-primary">
					&#9654; Execute
				</button>
				<button id="clearBtn" class="btn btn-secondary">
					&#x1F5D1; Clear
				</button>
				<span class="spacer"></span>
				<span class="shortcut-hint">Enter to send, Shift+Enter for new line</span>
			</div>
		</div>
	</div>
</body>
</html>`;

async function getCurrentNote(): Promise<{ id: string; title: string; body: string } | null> {
	const note = await joplin.workspace.selectedNote();
	if (!note) return null;

	const full = await joplin.data.get(['notes', note.id], { fields: ['id', 'title', 'body'] });
	return full;
}

async function sendNoteInfo(handle: ViewHandle) {
	const note = await getCurrentNote();
	joplin.views.panels.postMessage(handle, {
		type: 'noteInfo',
		title: note ? note.title : null,
	});
}

async function handleExecute(handle: ViewHandle, prompt: string) {
	try {
		const settings = await joplin.settings.values([
			SETTING_KEYS.provider,
			SETTING_KEYS.openaiKey,
			SETTING_KEYS.openaiModel,
			SETTING_KEYS.claudeKey,
			SETTING_KEYS.claudeModel,
		]);

		const provider = (settings[SETTING_KEYS.provider] as AIProvider) ?? 'openai';
		const apiKey =
			provider === 'openai'
				? (settings[SETTING_KEYS.openaiKey] as string)
				: (settings[SETTING_KEYS.claudeKey] as string);
		const model =
			provider === 'openai'
				? (settings[SETTING_KEYS.openaiModel] as string)
				: (settings[SETTING_KEYS.claudeModel] as string);

		if (!apiKey?.trim()) {
			joplin.views.panels.postMessage(handle, {
				type: 'alert',
				message: `API key for ${provider} is not configured. Go to Settings → AI Assistant to set it up.`,
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

		const context = { currentNoteId: note.id, currentNoteTitle: note.title };
		const response = await sendToAI(
			provider,
			apiKey,
			model,
			prompt,
			note.title,
			note.body,
			context,
		);

		joplin.views.panels.postMessage(handle, {
			type: 'result',
			isEdit: response.isEdit,
			content: response.content,
			actions: response.actions,
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
}

export async function initPanel() {
	panelHandle = await joplin.views.panels.create('aiAssistantPanel');
	await joplin.views.panels.setHtml(panelHandle, PANEL_HTML);
	await joplin.views.panels.addScript(panelHandle, './webview/panel.css');
	await joplin.views.panels.addScript(panelHandle, './webview/panel.js');
	await joplin.views.panels.hide(panelHandle);
	panelVisible = false;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await joplin.views.panels.onMessage(panelHandle, async (message: any) => {
		if (!panelHandle) return;

		if (message.type === 'execute') {
			await handleExecute(panelHandle, message.prompt);
		}

		if (message.type === 'getNote') {
			await sendNoteInfo(panelHandle);
		}
	});

	await joplin.workspace.onNoteSelectionChange(async () => {
		if (panelHandle && panelVisible) {
			await sendNoteInfo(panelHandle);
		}
	});
}

export async function togglePanel() {
	if (!panelHandle) return;

	panelVisible = !panelVisible;
	if (panelVisible) {
		await joplin.views.panels.show(panelHandle);
		await sendNoteInfo(panelHandle);
	} else {
		await joplin.views.panels.hide(panelHandle);
	}
}
