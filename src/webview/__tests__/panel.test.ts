/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

const markdownJsSource = fs.readFileSync(path.resolve(__dirname, '..', 'markdown.js'), 'utf-8');
const iconsJsSource = fs.readFileSync(path.resolve(__dirname, '..', 'icons.js'), 'utf-8');
const panelJsSource = fs.readFileSync(path.resolve(__dirname, '..', 'panel.js'), 'utf-8');

const buildDOM = (): void => {
	document.body.innerHTML = `
		<div id="app">
			<div class="header">
				<div class="header-title">
					<span class="icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/></svg></span>
					AI Assistant
					<button id="settingsBtn" class="icon-btn header-settings-btn" title="AI Settings"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg></button>
				</div>
				<div id="noteInfo" class="note-info"></div>
				<div class="role-bar" id="roleBar">
					<select id="roleSelect" class="role-select">
						<option value="">No role</option>
					</select>
					<button id="applyRoleBtn" class="btn btn-sm">Apply</button>
					<button id="manageRolesBtn" class="btn btn-sm">Roles</button>
				</div>
			</div>
			<div class="messages" id="messages">
				<div class="empty-state" id="emptyState"></div>
			</div>
			<div id="queueContainer" class="queue-container"></div>
			<div class="input-area">
				<div class="input-container">
					<div id="fileChips" class="file-chips"></div>
					<div class="textarea-wrap">
						<textarea id="promptInput"></textarea>
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
							<button id="attachFileBtn" class="icon-btn" title="Attach file"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19"/></svg></button>
							<button id="clearBtn" class="icon-btn" title="Clear input"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
						</div>
						<div class="bottom-bar-right">
							<div id="contextSizeContainer" class="context-size-container"></div>
							<button id="clearHistoryBtn" class="icon-btn" title="Clear history"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/></svg></button>
							<button id="stopBtn" class="btn stop-btn" style="display:none">■</button>
							<button id="executeBtn" class="btn send-btn"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/></svg></button>
						</div>
					</div>
				</div>
				<input type="file" id="fileInput" style="display:none" multiple accept=".txt,.md,.csv,.json,.xml,.js,.ts,.py,.java,.c,.cpp,.h,.html,.css,.yaml,.yml,.toml,.ini,.cfg,.log,.sh,.bat,.sql,.r,.rb,.go,.rs,.swift,.kt,.scala,.lua,.pl,.php" />
			</div>
			<div id="roleManageView" class="role-manage-view" style="display: none;"></div>
			<div id="settingsManageView" class="settings-manage-view" style="display: none;"></div>
		</div>
	`;
};

const createMockWebviewApi = () => ({
	postMessage: jest.fn(),
	onMessage: jest.fn(),
});

const initPanel = (mockApi: ReturnType<typeof createMockWebviewApi>): void => {
	(window as any).webviewApi = mockApi;
	eval(markdownJsSource);
	eval(iconsJsSource);
	eval(panelJsSource);
	document.dispatchEvent(new Event('DOMContentLoaded'));
};

const pressKey = (
	element: HTMLElement,
	key: string,
	modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): KeyboardEvent => {
	const event = new KeyboardEvent('keydown', {
		key,
		bubbles: true,
		cancelable: true,
		...modifiers,
	});
	element.dispatchEvent(event);
	return event;
};

beforeEach(() => {
	localStorage.clear();
});

describe('panel.js alert message handling', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('shows alert as agent message in chat when alert is received', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'alert',
			message: 'API key for openai is not configured. Go to Settings → AI Assistant to set it up.',
		});

		const alertMsg = document.querySelector('.message-alert') as HTMLElement;
		expect(alertMsg).not.toBeNull();
		expect(alertMsg.textContent).toContain('API key for openai is not configured');
	});

	it('hides loading indicator when alert message is received', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'loading', status: true });
		expect(document.getElementById('loadingIndicator')).not.toBeNull();

		messageHandler({ type: 'alert', message: 'Key missing' });
		expect(document.getElementById('loadingIndicator')).toBeNull();
	});

	it('shows stop button during loading and hides it after alert', () => {
		const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		messageHandler({ type: 'loading', status: true });
		expect(stopBtn?.style.display).not.toBe('none');

		messageHandler({ type: 'alert', message: 'Key missing' });
		expect(stopBtn?.style.display).toBe('none');
	});

	it('accumulates multiple alert messages in chat', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'alert', message: 'First alert' });
		messageHandler({ type: 'alert', message: 'Second alert' });

		const alerts = document.querySelectorAll('.message-alert');
		expect(alerts).toHaveLength(2);
		expect(alerts[0].textContent).toContain('First alert');
		expect(alerts[1].textContent).toContain('Second alert');
	});

	it('displays alert with AI label', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'alert', message: 'Key missing' });

		const label = document.querySelector('.message-alert .message-label') as HTMLElement;
		expect(label).not.toBeNull();
		expect(label.textContent).toBe('AI');
	});
});

describe('PANEL_HTML button icons', () => {
	let container: HTMLDivElement;

	beforeEach(() => {
		const panelTsSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'panel.ts'), 'utf-8');
		const htmlMatch = panelTsSource.match(/const CHAT_PANEL_HTML = `([\s\S]*?)`;/);
		expect(htmlMatch).not.toBeNull();

		container = document.createElement('div');
		container.innerHTML = htmlMatch![1];
	});

	it('should include a clear button with icon-btn class', () => {
		const clearBtn = container.querySelector('#clearBtn');
		expect(clearBtn).not.toBeNull();
		expect(clearBtn!.classList.contains('icon-btn')).toBe(true);
	});

	it('should include a Clear History button with icon-btn class', () => {
		const clearHistoryBtn = container.querySelector('#clearHistoryBtn');
		expect(clearHistoryBtn).not.toBeNull();
		expect(clearHistoryBtn!.classList.contains('icon-btn')).toBe(true);
	});

	it('should include an attach file button', () => {
		const attachFileBtn = container.querySelector('#attachFileBtn');
		expect(attachFileBtn).not.toBeNull();
	});

	it('should include a hidden file input element', () => {
		const fileInput = container.querySelector('#fileInput') as HTMLInputElement;
		expect(fileInput).not.toBeNull();
		expect(fileInput.type).toBe('file');
	});

	it('should include a file chips container', () => {
		const fileChips = container.querySelector('#fileChips');
		expect(fileChips).not.toBeNull();
	});
});

describe('panel.js clear button', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;
	let clearBtn: HTMLButtonElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('clears the prompt input value', () => {
		promptInput.value = 'Some draft text';
		clearBtn.click();

		expect(promptInput.value).toBe('');
	});

	it('resets textarea height to auto', () => {
		promptInput.style.height = '120px';
		clearBtn.click();

		expect(promptInput.style.height).toBe('auto');
	});

	it('does NOT clear chat messages when clicked', () => {
		const messagesEl = document.getElementById('messages') as HTMLElement;

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'result', content: 'AI response', isEdit: false });

		const messagesBefore = messagesEl.querySelectorAll('.message').length;
		expect(messagesBefore).toBeGreaterThan(0);

		clearBtn.click();

		const messagesAfter = messagesEl.querySelectorAll('.message').length;
		expect(messagesAfter).toBe(messagesBefore);
	});

	it('does NOT restore empty state when clicked', () => {
		const emptyState = document.getElementById('emptyState') as HTMLElement;

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'result', content: 'AI response', isEdit: false });
		expect(emptyState.style.display).toBe('none');

		clearBtn.click();

		expect(emptyState.style.display).toBe('none');
	});
});

describe('panel.js clear history button', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;
	let clearHistoryBtn: HTMLButtonElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		clearHistoryBtn = document.getElementById('clearHistoryBtn') as HTMLButtonElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('exists in the DOM', () => {
		expect(clearHistoryBtn).not.toBeNull();
	});

	it('clears all chat messages', () => {
		const messagesEl = document.getElementById('messages') as HTMLElement;

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'result', content: 'AI response', isEdit: false });
		expect(messagesEl.querySelectorAll('.message').length).toBeGreaterThan(0);

		clearHistoryBtn.click();

		expect(messagesEl.querySelector('.message')).toBeNull();
	});

	it('restores empty state after clearing history', () => {
		const emptyState = document.getElementById('emptyState') as HTMLElement;

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'result', content: 'AI response', isEdit: false });
		expect(emptyState.style.display).toBe('none');

		clearHistoryBtn.click();

		expect(emptyState.style.display).toBe('');
	});

	it('does NOT clear the prompt input value', () => {
		promptInput.value = 'My draft prompt';

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'result', content: 'AI response', isEdit: false });

		clearHistoryBtn.click();

		expect(promptInput.value).toBe('My draft prompt');
	});
});

describe('panel.js conversation history tracking', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('sends empty history array on first execute', () => {
		promptInput.value = 'Hello';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'execute', prompt: 'Hello', history: [] }),
		);
	});

	it('includes prior user and AI messages in history on second execute', () => {
		promptInput.value = 'Hello';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'result', content: 'Hi there!', isEdit: false, actions: [] });

		promptInput.value = 'Tell me more';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const secondCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'Tell me more',
		);
		expect(secondCall).toBeDefined();
		expect(secondCall![0].history).toEqual([
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
		]);
	});

	it('accumulates history across multiple exchanges', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'First';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'result', content: 'Reply 1', isEdit: false, actions: [] });

		promptInput.value = 'Second';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'result', content: 'Reply 2', isEdit: false, actions: [] });

		promptInput.value = 'Third';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const thirdCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'Third',
		);
		expect(thirdCall![0].history).toEqual([
			{ role: 'user', content: 'First' },
			{ role: 'assistant', content: 'Reply 1' },
			{ role: 'user', content: 'Second' },
			{ role: 'assistant', content: 'Reply 2' },
		]);
	});

	it('includes action summaries in assistant history entry when tools are used', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'Create a note called Test';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({
			type: 'result',
			content: 'Done!',
			isEdit: false,
			actions: [{ action: 'create_note', success: true, message: 'Note "Test" created' }],
		});

		promptInput.value = 'What was the note ID?';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const secondCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'What was the note ID?',
		);
		const assistantEntry = secondCall![0].history[1];
		expect(assistantEntry.role).toBe('assistant');
		expect(assistantEntry.content).toContain('create_note');
		expect(assistantEntry.content).toContain('Note "Test" created');
		expect(assistantEntry.content).toContain('Done!');
	});

	it('preserves history when content is empty but actions exist', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'Tag this as important';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({
			type: 'result',
			content: '',
			isEdit: false,
			actions: [{ action: 'add_tag', success: true, message: 'Tag "important" added to note' }],
		});

		promptInput.value = 'Next question';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const secondCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'Next question',
		);
		expect(secondCall![0].history).toHaveLength(2);
		expect(secondCall![0].history[0]).toEqual({
			role: 'user',
			content: 'Tag this as important',
		});
		expect(secondCall![0].history[1].role).toBe('assistant');
		expect(secondCall![0].history[1].content).toContain('add_tag');
		expect(secondCall![0].history[1].content).toContain('Tag "important" added to note');
	});

	it('includes action data (e.g. note IDs from search) in assistant history entry', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'find notes about PDF';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({
			type: 'result',
			content: 'I found two notes.',
			isEdit: false,
			actions: [
				{
					action: 'search_notes',
					success: true,
					message: 'Found 2 note(s)',
					data: {
						notes: [
							{ id: 'abc-123', title: '2. Importing and exporting notes', parentId: 'f1' },
							{ id: 'def-456', title: '4. Tips', parentId: 'f2' },
						],
					},
				},
			],
		});

		promptInput.value = 'open 2';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const secondCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'open 2',
		);
		const assistantEntry = secondCall![0].history[1];
		expect(assistantEntry.role).toBe('assistant');
		expect(assistantEntry.content).toContain('abc-123');
		expect(assistantEntry.content).toContain('def-456');
		expect(assistantEntry.content).toContain('2. Importing and exporting notes');
		expect(assistantEntry.content).toContain('4. Tips');
	});

	it('does not add to history when response has no content and no actions', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'Edit note';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({
			type: 'result',
			content: '',
			isEdit: true,
			actions: [],
		});

		promptInput.value = 'Next question';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const secondCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'Next question',
		);
		expect(secondCall![0].history).toEqual([]);
	});

	it('does not add to history on error response', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'Bad request';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'error', message: 'Something went wrong' });

		promptInput.value = 'Try again';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const secondCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'Try again',
		);
		expect(secondCall![0].history).toEqual([]);
	});

	it('clears history when clear history button is clicked', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		const clearHistoryBtn = document.getElementById('clearHistoryBtn') as HTMLButtonElement;

		promptInput.value = 'Hello';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'result', content: 'Hi!', isEdit: false, actions: [] });

		clearHistoryBtn.click();

		promptInput.value = 'Fresh start';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const freshCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'Fresh start',
		);
		expect(freshCall![0].history).toEqual([]);
	});
});

describe('panel.js noteId pinning in execute messages', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('includes noteId from last noteInfo message in execute payload', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteInfo', noteId: 'note-abc', title: 'My Note' });

		promptInput.value = 'Summarize this';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const executeCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCall).toBeDefined();
		expect(executeCall![0].noteId).toBe('note-abc');
	});

	it('updates noteId when user switches notes and sends new execute', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteInfo', noteId: 'note-1', title: 'First Note' });

		promptInput.value = 'First question';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		messageHandler({ type: 'result', content: 'Response 1', isEdit: false, actions: [] });
		messageHandler({ type: 'noteInfo', noteId: 'note-2', title: 'Second Note' });

		promptInput.value = 'Second question';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const secondCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'Second question',
		);
		expect(secondCall).toBeDefined();
		expect(secondCall![0].noteId).toBe('note-2');
	});

	it('pins noteId at dispatch time so queued messages keep the original note', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteInfo', noteId: 'note-A', title: 'Note A' });

		promptInput.value = 'First';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		messageHandler({ type: 'noteInfo', noteId: 'note-B', title: 'Note B' });

		promptInput.value = 'Second (queued)';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const firstCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'First',
		);
		expect(firstCall![0].noteId).toBe('note-A');

		messageHandler({ type: 'result', content: 'Done', isEdit: false, actions: [] });

		const queuedCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute' && call[0]?.prompt === 'Second (queued)',
		);
		expect(queuedCall).toBeDefined();
		expect(queuedCall![0].noteId).toBe('note-B');
	});
});

describe('panel.js keyboard handling', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('sends execute on plain Enter when prompt has text', () => {
		promptInput.value = 'Hello AI';
		pressKey(promptInput, 'Enter');

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'execute', prompt: 'Hello AI' }),
		);
	});

	it('sends execute on Ctrl+Enter when prompt has text', () => {
		promptInput.value = 'Hello AI';
		pressKey(promptInput, 'Enter', { ctrlKey: true });

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'execute', prompt: 'Hello AI' }),
		);
	});

	it('sends execute on Cmd+Enter when prompt has text', () => {
		promptInput.value = 'Hello AI';
		pressKey(promptInput, 'Enter', { metaKey: true });

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'execute', prompt: 'Hello AI' }),
		);
	});

	it('does NOT send execute on Shift+Enter (allows newline)', () => {
		promptInput.value = 'Hello AI';
		const event = pressKey(promptInput, 'Enter', { shiftKey: true });

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(0);
		expect(event.defaultPrevented).toBe(false);
	});

	it('does NOT send execute when prompt is empty', () => {
		promptInput.value = '';
		pressKey(promptInput, 'Enter');

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(0);
	});

	it('does NOT send execute when prompt is whitespace only', () => {
		promptInput.value = '   ';
		pressKey(promptInput, 'Enter');

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(0);
	});

	it('prevents default on plain Enter to avoid newline insertion', () => {
		promptInput.value = 'Hello AI';
		const event = pressKey(promptInput, 'Enter');

		expect(event.defaultPrevented).toBe(true);
	});

	it('clears input after sending on Enter', () => {
		promptInput.value = 'Hello AI';
		pressKey(promptInput, 'Enter');

		expect(promptInput.value).toBe('');
	});

	it('does NOT send execute on Ctrl+A', () => {
		promptInput.value = 'Hello AI';
		pressKey(promptInput, 'a', { ctrlKey: true });

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(0);
	});

	it('does NOT send execute on Cmd+A', () => {
		promptInput.value = 'Hello AI';
		pressKey(promptInput, 'a', { metaKey: true });

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(0);
	});

	it('stops propagation on Ctrl+A to prevent host interception', () => {
		const event = new KeyboardEvent('keydown', {
			key: 'a',
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		});
		const stopPropagationSpy = jest.spyOn(event, 'stopPropagation');
		promptInput.dispatchEvent(event);

		expect(stopPropagationSpy).toHaveBeenCalled();
	});

	it('does NOT prevent default on Ctrl+A so native select-all is preserved', () => {
		const event = new KeyboardEvent('keydown', {
			key: 'a',
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		});
		promptInput.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(false);
	});

	it('stops propagation on Cmd+Shift+A (registered Joplin panel-toggle shortcut)', () => {
		const event = new KeyboardEvent('keydown', {
			key: 'A',
			metaKey: true,
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		const stopPropagationSpy = jest.spyOn(event, 'stopPropagation');
		promptInput.dispatchEvent(event);

		expect(stopPropagationSpy).toHaveBeenCalled();
	});

	it('prevents default on Ctrl+Shift+A (registered Joplin panel-toggle shortcut)', () => {
		const event = new KeyboardEvent('keydown', {
			key: 'A',
			ctrlKey: true,
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		promptInput.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
	});

	it('does NOT send execute on Ctrl+Shift+A', () => {
		promptInput.value = 'Hello AI';
		pressKey(promptInput, 'A', { ctrlKey: true, shiftKey: true });

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(0);
	});
});

describe('panel.js agent role selector', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('requests agent roles on initialization', () => {
		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'getAgentRoles' }),
		);
	});

	it('populates role dropdown when agentRoles message is received', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [
				{ id: 'r1', name: 'Coder', systemPrompt: 'You code' },
				{ id: 'r2', name: 'Writer', systemPrompt: 'You write' },
			],
		});

		const select = document.getElementById('roleSelect') as HTMLSelectElement;
		expect(select.options.length).toBe(3);
		expect(select.options[1].textContent).toBe('Coder');
		expect(select.options[2].textContent).toBe('Writer');
	});

	it('sends agentRolePrompt with execute when role is applied', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You are a coding expert' }],
		});

		const select = document.getElementById('roleSelect') as HTMLSelectElement;
		select.value = 'r1';
		select.dispatchEvent(new Event('change'));

		const applyBtn = document.getElementById('applyRoleBtn') as HTMLButtonElement;
		applyBtn.click();

		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'Help me code';
		pressKey(promptInput, 'Enter');

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'execute',
				prompt: 'Help me code',
				agentRolePrompt: 'You are a coding expert',
			}),
		);
	});

	it('does not send agentRolePrompt when no role is selected', () => {
		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'Hello';
		pressKey(promptInput, 'Enter');

		const executeCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCall![0].agentRolePrompt).toBeUndefined();
	});

	it('clears applied role when "No role" option is selected and applied', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const select = document.getElementById('roleSelect') as HTMLSelectElement;
		const applyBtn = document.getElementById('applyRoleBtn') as HTMLButtonElement;

		select.value = 'r1';
		select.dispatchEvent(new Event('change'));
		applyBtn.click();

		select.value = '';
		select.dispatchEvent(new Event('change'));
		applyBtn.click();

		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'Hello';
		pressKey(promptInput, 'Enter');

		const executeCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCall![0].agentRolePrompt).toBeUndefined();
	});

	it('shows active role indicator after applying', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const select = document.getElementById('roleSelect') as HTMLSelectElement;
		select.value = 'r1';
		select.dispatchEvent(new Event('change'));

		const applyBtn = document.getElementById('applyRoleBtn') as HTMLButtonElement;
		applyBtn.click();

		const indicator = document.querySelector('.role-active-indicator');
		expect(indicator).not.toBeNull();
		expect(indicator!.textContent).toContain('Coder');
	});
});

describe('panel.js agent role management', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('opens management view when manage button is clicked', () => {
		const manageBtn = document.getElementById('manageRolesBtn') as HTMLButtonElement;
		manageBtn.click();

		const manageView = document.getElementById('roleManageView') as HTMLElement;
		expect(manageView.style.display).not.toBe('none');
	});

	it('shows add role form in management view', () => {
		const manageBtn = document.getElementById('manageRolesBtn') as HTMLButtonElement;
		manageBtn.click();

		const nameInput = document.getElementById('roleNameInput') as HTMLInputElement;
		const promptInput = document.getElementById('rolePromptInput') as HTMLTextAreaElement;
		const saveBtn = document.getElementById('saveRoleBtn') as HTMLButtonElement;

		expect(nameInput).not.toBeNull();
		expect(promptInput).not.toBeNull();
		expect(saveBtn).not.toBeNull();
	});

	it('adds a new role via management form', () => {
		const manageBtn = document.getElementById('manageRolesBtn') as HTMLButtonElement;
		manageBtn.click();

		const nameInput = document.getElementById('roleNameInput') as HTMLInputElement;
		const promptTextarea = document.getElementById('rolePromptInput') as HTMLTextAreaElement;
		const saveBtn = document.getElementById('saveRoleBtn') as HTMLButtonElement;

		nameInput.value = 'My Agent';
		promptTextarea.value = 'You are a helpful assistant';
		saveBtn.click();

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'saveAgentRoles',
				roles: expect.arrayContaining([
					expect.objectContaining({
						name: 'My Agent',
						systemPrompt: 'You are a helpful assistant',
					}),
				]),
			}),
		);
	});

	it('lists existing roles in management view', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [
				{ id: 'r1', name: 'Coder', systemPrompt: 'You code' },
				{ id: 'r2', name: 'Writer', systemPrompt: 'You write' },
			],
		});

		const manageBtn = document.getElementById('manageRolesBtn') as HTMLButtonElement;
		manageBtn.click();

		const roleItems = document.querySelectorAll('.role-list-item');
		expect(roleItems.length).toBe(2);
	});

	it('deletes a role via management view', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [
				{ id: 'r1', name: 'Coder', systemPrompt: 'You code' },
				{ id: 'r2', name: 'Writer', systemPrompt: 'You write' },
			],
		});

		const manageBtn = document.getElementById('manageRolesBtn') as HTMLButtonElement;
		manageBtn.click();

		const deleteButtons = document.querySelectorAll('.delete-role-btn');
		expect(deleteButtons.length).toBe(2);

		(deleteButtons[0] as HTMLButtonElement).click();

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'saveAgentRoles',
				roles: [expect.objectContaining({ id: 'r2', name: 'Writer' })],
			}),
		);
	});

	it('edits an existing role via management view', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const manageBtn = document.getElementById('manageRolesBtn') as HTMLButtonElement;
		manageBtn.click();

		const editButtons = document.querySelectorAll('.edit-role-btn');
		expect(editButtons.length).toBe(1);

		(editButtons[0] as HTMLButtonElement).click();

		const nameInput = document.getElementById('roleNameInput') as HTMLInputElement;
		const promptTextarea = document.getElementById('rolePromptInput') as HTMLTextAreaElement;

		expect(nameInput.value).toBe('Coder');
		expect(promptTextarea.value).toBe('You code');

		nameInput.value = 'Senior Coder';
		promptTextarea.value = 'You are an expert coder';

		const saveBtn = document.getElementById('saveRoleBtn') as HTMLButtonElement;
		saveBtn.click();

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'saveAgentRoles',
				roles: [
					expect.objectContaining({
						id: 'r1',
						name: 'Senior Coder',
						systemPrompt: 'You are an expert coder',
					}),
				],
			}),
		);
	});

	it('closes management view when close button is clicked', () => {
		const manageBtn = document.getElementById('manageRolesBtn') as HTMLButtonElement;
		manageBtn.click();

		const closeBtn = document.getElementById('closeManageView') as HTMLButtonElement;
		expect(closeBtn).not.toBeNull();

		closeBtn.click();

		const manageView = document.getElementById('roleManageView') as HTMLElement;
		expect(manageView.style.display).toBe('none');
	});
});

describe('panel.js work mode selector', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('renders mode selector in the DOM', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		expect(modeSelect).not.toBeNull();
	});

	it('has three mode options: ask, agent, edit', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		const values = Array.from(modeSelect.options).map((o) => o.value);
		expect(values).toContain('ask');
		expect(values).toContain('agent');
		expect(values).toContain('edit');
		expect(modeSelect.options).toHaveLength(3);
	});

	it('defaults to "agent" mode', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		expect(modeSelect.value).toBe('agent');
	});

	it('sends workMode with execute message', () => {
		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'Hello AI';
		pressKey(promptInput, 'Enter');

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'execute',
				prompt: 'Hello AI',
				workMode: 'agent',
			}),
		);
	});

	it('sends selected workMode when mode is changed to "ask"', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		modeSelect.value = 'ask';
		modeSelect.dispatchEvent(new Event('change'));

		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'What is this about?';
		pressKey(promptInput, 'Enter');

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'execute',
				prompt: 'What is this about?',
				workMode: 'ask',
			}),
		);
	});

	it('sends selected workMode when mode is changed to "edit"', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		modeSelect.value = 'edit';
		modeSelect.dispatchEvent(new Event('change'));

		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'Fix the command';
		pressKey(promptInput, 'Enter');

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'execute',
				prompt: 'Fix the command',
				workMode: 'edit',
			}),
		);
	});

	it('shows mode label descriptions', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		const labels = Array.from(modeSelect.options).map((o) => o.textContent);
		expect(labels.some((l) => l!.toLowerCase().includes('ask'))).toBe(true);
		expect(labels.some((l) => l!.toLowerCase().includes('agent'))).toBe(true);
		expect(labels.some((l) => l!.toLowerCase().includes('edit'))).toBe(true);
	});

	it('updates placeholder text when mode changes to "edit"', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		modeSelect.value = 'edit';
		modeSelect.dispatchEvent(new Event('change'));

		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		expect(promptInput.placeholder.toLowerCase()).toContain('edit');
	});

	it('updates placeholder text when mode changes to "ask"', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		modeSelect.value = 'ask';
		modeSelect.dispatchEvent(new Event('change'));

		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		expect(promptInput.placeholder.toLowerCase()).toContain('ask');
	});
});

describe('panel.js @note reference autocomplete', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('sends searchNotes message when @ is typed followed by [', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const searchCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'searchNotes',
		);
		expect(searchCalls.length).toBeGreaterThanOrEqual(1);
		expect(searchCalls[searchCalls.length - 1][0].query).toBe('Des');
	});

	it('sends searchNotes when @ is typed followed by a word (without brackets)', () => {
		promptInput.value = 'open @dog';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const searchCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'searchNotes',
		);
		expect(searchCalls.length).toBeGreaterThanOrEqual(1);
		expect(searchCalls[searchCalls.length - 1][0].query).toBe('dog');
	});

	it('sends searchNotes for @word at the start of input', () => {
		promptInput.value = '@Dog';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const searchCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'searchNotes',
		);
		expect(searchCalls.length).toBeGreaterThanOrEqual(1);
		expect(searchCalls[searchCalls.length - 1][0].query).toBe('Dog');
	});

	it('sends searchNotes for multi-word @query using @[partial', () => {
		promptInput.value = 'Check @[Dog Post';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const searchCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'searchNotes',
		);
		expect(searchCalls.length).toBeGreaterThanOrEqual(1);
		expect(searchCalls[searchCalls.length - 1][0].query).toBe('Dog Post');
	});

	it('does not send searchNotes for email-like patterns', () => {
		promptInput.value = 'email user@example';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const searchCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'searchNotes',
		);
		expect(searchCalls).toHaveLength(0);
	});

	it('shows autocomplete dropdown when noteSearchResults are received', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [
				{ id: 's1', title: 'Design Doc' },
				{ id: 's2', title: 'Design Spec' },
			],
		});

		const dropdown = document.querySelector('.note-autocomplete-dropdown') as HTMLElement;
		expect(dropdown).not.toBeNull();
		expect(dropdown.children.length).toBe(2);
		expect(dropdown.textContent).toContain('Design Doc');
		expect(dropdown.textContent).toContain('Design Spec');
	});

	it('inserts @[Title] when a suggestion is clicked (bracket trigger)', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [{ id: 's1', title: 'Design Doc' }],
		});

		const dropdown = document.querySelector('.note-autocomplete-dropdown') as HTMLElement;
		const firstItem = dropdown.children[0] as HTMLElement;
		firstItem.click();

		expect(promptInput.value).toBe('Check @[Design Doc] ');
		expect(document.querySelector('.note-autocomplete-dropdown')).toBeNull();
	});

	it('inserts @[Title] when a suggestion is clicked (bare @word trigger)', () => {
		promptInput.value = 'open @dog';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [{ id: 'd1', title: 'Dog Post Day 1 - Labrador' }],
		});

		const dropdown = document.querySelector('.note-autocomplete-dropdown') as HTMLElement;
		const firstItem = dropdown.children[0] as HTMLElement;
		firstItem.click();

		expect(promptInput.value).toBe('open @[Dog Post Day 1 - Labrador] ');
		expect(document.querySelector('.note-autocomplete-dropdown')).toBeNull();
	});

	it('closes dropdown on Escape key', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [{ id: 's1', title: 'Design Doc' }],
		});

		expect(document.querySelector('.note-autocomplete-dropdown')).not.toBeNull();

		pressKey(promptInput, 'Escape');

		expect(document.querySelector('.note-autocomplete-dropdown')).toBeNull();
	});

	it('hides dropdown when results are empty', () => {
		promptInput.value = 'Check @[zzz';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteSearchResults', notes: [] });

		expect(document.querySelector('.note-autocomplete-dropdown')).toBeNull();
	});

	it('appends autocomplete dropdown outside input-container to avoid overflow clipping', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [{ id: 's1', title: 'Design Doc' }],
		});

		const dropdown = document.querySelector('.note-autocomplete-dropdown') as HTMLElement;
		expect(dropdown).not.toBeNull();
		const inputContainer = document.querySelector('.input-container') as HTMLElement;
		expect(inputContainer.contains(dropdown)).toBe(false);
	});

	it('auto-focuses the first item in the autocomplete dropdown', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [
				{ id: 's1', title: 'Design Doc' },
				{ id: 's2', title: 'Design Spec' },
			],
		});

		const items = document.querySelectorAll('.note-autocomplete-item');
		expect(items[0].classList.contains('note-autocomplete-item--focused')).toBe(true);
		expect(items[1].classList.contains('note-autocomplete-item--focused')).toBe(false);
	});

	it('moves focus down with ArrowDown key', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [
				{ id: 's1', title: 'Design Doc' },
				{ id: 's2', title: 'Design Spec' },
			],
		});

		pressKey(promptInput, 'ArrowDown');

		const items = document.querySelectorAll('.note-autocomplete-item');
		expect(items[0].classList.contains('note-autocomplete-item--focused')).toBe(false);
		expect(items[1].classList.contains('note-autocomplete-item--focused')).toBe(true);
	});

	it('moves focus up with ArrowUp key', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [
				{ id: 's1', title: 'Design Doc' },
				{ id: 's2', title: 'Design Spec' },
			],
		});

		pressKey(promptInput, 'ArrowDown');
		pressKey(promptInput, 'ArrowUp');

		const items = document.querySelectorAll('.note-autocomplete-item');
		expect(items[0].classList.contains('note-autocomplete-item--focused')).toBe(true);
		expect(items[1].classList.contains('note-autocomplete-item--focused')).toBe(false);
	});

	it('wraps focus from last to first item on ArrowDown', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [
				{ id: 's1', title: 'Design Doc' },
				{ id: 's2', title: 'Design Spec' },
			],
		});

		pressKey(promptInput, 'ArrowDown');
		pressKey(promptInput, 'ArrowDown');

		const items = document.querySelectorAll('.note-autocomplete-item');
		expect(items[0].classList.contains('note-autocomplete-item--focused')).toBe(true);
	});

	it('inserts focused item on Enter when autocomplete is active', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [
				{ id: 's1', title: 'Design Doc' },
				{ id: 's2', title: 'Design Spec' },
			],
		});

		pressKey(promptInput, 'Enter');

		expect(promptInput.value).toBe('Check @[Design Doc] ');
		expect(document.querySelector('.note-autocomplete-dropdown')).toBeNull();
	});

	it('does not send execute when Enter selects an autocomplete item', () => {
		promptInput.value = 'Check @[Des';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'noteSearchResults',
			notes: [{ id: 's1', title: 'Design Doc' }],
		});

		mockApi.postMessage.mockClear();
		pressKey(promptInput, 'Enter');

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(0);
	});

	it('does not send searchNotes when query after @[ is empty', () => {
		promptInput.value = 'Check @[';
		promptInput.selectionStart = promptInput.value.length;
		promptInput.selectionEnd = promptInput.value.length;
		promptInput.dispatchEvent(new Event('input', { bubbles: true }));

		const searchCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'searchNotes',
		);
		expect(searchCalls).toHaveLength(0);
	});
});

describe('panel.js file attachment', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;
	let attachFileBtn: HTMLButtonElement;
	let fileInput: HTMLInputElement;
	let fileChips: HTMLElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		attachFileBtn = document.getElementById('attachFileBtn') as HTMLButtonElement;
		fileInput = document.getElementById('fileInput') as HTMLInputElement;
		fileChips = document.getElementById('fileChips') as HTMLElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('renders the attach file button in the DOM', () => {
		expect(attachFileBtn).not.toBeNull();
		expect(attachFileBtn.classList.contains('icon-btn')).toBe(true);
	});

	it('renders a hidden file input element', () => {
		expect(fileInput).not.toBeNull();
		expect(fileInput.style.display).toBe('none');
		expect(fileInput.type).toBe('file');
		expect(fileInput.multiple).toBe(true);
	});

	it('triggers file input click when attach button is clicked', () => {
		const clickSpy = jest.spyOn(fileInput, 'click');
		attachFileBtn.click();
		expect(clickSpy).toHaveBeenCalled();
	});

	it('shows file chip when a text file is selected', (done) => {
		const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const chips = fileChips.querySelectorAll('.file-chip');
			expect(chips.length).toBe(1);
			expect(chips[0].textContent).toContain('test.txt');
			done();
		}, 100);
	});

	it('removes file chip when remove button is clicked', (done) => {
		const file = new File(['content'], 'doc.txt', { type: 'text/plain' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const removeBtn = fileChips.querySelector('.file-chip-remove') as HTMLButtonElement;
			expect(removeBtn).not.toBeNull();
			removeBtn.click();
			expect(fileChips.querySelectorAll('.file-chip').length).toBe(0);
			done();
		}, 100);
	});

	it('includes attachedFiles in execute message when files are attached', (done) => {
		const file = new File(['file content'], 'data.csv', { type: 'text/csv' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			promptInput.value = 'Analyze this file';
			pressKey(promptInput, 'Enter');
			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'execute',
					prompt: 'Analyze this file',
					attachedFiles: expect.arrayContaining([
						expect.objectContaining({
							name: 'data.csv',
							content: 'file content',
						}),
					]),
				}),
			);
			done();
		}, 100);
	});

	it('does not include attachedFiles when no files are attached', () => {
		promptInput.value = 'Hello';
		pressKey(promptInput, 'Enter');
		const executeCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCall![0].attachedFiles).toBeUndefined();
	});

	it('clears file chips after sending execute', (done) => {
		const file = new File(['content'], 'file.txt', { type: 'text/plain' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			promptInput.value = 'Process this';
			pressKey(promptInput, 'Enter');
			expect(fileChips.querySelectorAll('.file-chip').length).toBe(0);
			done();
		}, 100);
	});

	it('supports multiple files from a single selection', (done) => {
		const file1 = new File(['content1'], 'file1.txt', { type: 'text/plain' });
		const file2 = new File(['content2'], 'file2.md', { type: 'text/markdown' });
		Object.defineProperty(fileInput, 'files', {
			value: [file1, file2],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const chips = fileChips.querySelectorAll('.file-chip');
			expect(chips.length).toBe(2);
			expect(chips[0].textContent).toContain('file1.txt');
			expect(chips[1].textContent).toContain('file2.md');
			done();
		}, 100);
	});

	it('clears file chips when clear button is clicked', (done) => {
		const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
		const file = new File(['content'], 'file.txt', { type: 'text/plain' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			clearBtn.click();
			expect(fileChips.querySelectorAll('.file-chip').length).toBe(0);
			done();
		}, 100);
	});
});

describe('panel.js file attachments shown under user message', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;
	let fileInput: HTMLInputElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		fileInput = document.getElementById('fileInput') as HTMLInputElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('shows attached file names under user message bubble when files are sent', (done) => {
		const file = new File(['hello world'], 'mar-27.txt', { type: 'text/plain' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			promptInput.value = 'what is in attached file?';
			pressKey(promptInput, 'Enter');

			const userMessages = document.querySelectorAll('.message-user');
			const lastUserMsg = userMessages[userMessages.length - 1] as HTMLElement;
			expect(lastUserMsg).not.toBeNull();

			const attachments = lastUserMsg.querySelector('.message-attachments');
			expect(attachments).not.toBeNull();
			expect(attachments!.textContent).toContain('mar-27.txt');
			done();
		}, 100);
	});

	it('shows multiple attached file names under user message', (done) => {
		const file1 = new File(['content1'], 'file1.txt', { type: 'text/plain' });
		const file2 = new File(['content2'], 'notes.md', { type: 'text/markdown' });
		Object.defineProperty(fileInput, 'files', {
			value: [file1, file2],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			promptInput.value = 'Analyze these files';
			pressKey(promptInput, 'Enter');

			const userMessages = document.querySelectorAll('.message-user');
			const lastUserMsg = userMessages[userMessages.length - 1] as HTMLElement;
			const attachmentChips = lastUserMsg.querySelectorAll('.message-attachment-chip');
			expect(attachmentChips.length).toBe(2);
			expect(attachmentChips[0].textContent).toContain('file1.txt');
			expect(attachmentChips[1].textContent).toContain('notes.md');
			done();
		}, 100);
	});

	it('does not show attachments section when no files are attached', () => {
		promptInput.value = 'Hello without files';
		pressKey(promptInput, 'Enter');

		const userMessages = document.querySelectorAll('.message-user');
		const lastUserMsg = userMessages[userMessages.length - 1] as HTMLElement;
		const attachments = lastUserMsg.querySelector('.message-attachments');
		expect(attachments).toBeNull();
	});

	it('shows attachments with paperclip icon', (done) => {
		const file = new File(['data'], 'report.csv', { type: 'text/csv' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			promptInput.value = 'Check this report';
			pressKey(promptInput, 'Enter');

			const userMessages = document.querySelectorAll('.message-user');
			const lastUserMsg = userMessages[userMessages.length - 1] as HTMLElement;
			const chip = lastUserMsg.querySelector('.message-attachment-chip') as HTMLElement;
			expect(chip).not.toBeNull();
			expect(chip.querySelector('svg')).not.toBeNull();
			done();
		}, 100);
	});

	it('shows file attachments under queued message when it is sent', (done) => {
		const file = new File(['queued content'], 'queued.txt', { type: 'text/plain' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			promptInput.value = 'First message';
			pressKey(promptInput, 'Enter');

			const file2 = new File(['second'], 'second.md', { type: 'text/markdown' });
			Object.defineProperty(fileInput, 'files', {
				value: [file2],
				writable: true,
				configurable: true,
			});
			fileInput.dispatchEvent(new Event('change'));
			setTimeout(() => {
				promptInput.value = 'Queued with file';
				pressKey(promptInput, 'Enter');

				const messageHandler = mockApi.onMessage.mock.calls[0][0];
				messageHandler({ type: 'result', content: 'Reply 1', isEdit: false, actions: [] });

				const userMessages = document.querySelectorAll('.message-user');
				const queuedMsg = userMessages[userMessages.length - 1] as HTMLElement;
				const attachments = queuedMsg.querySelector('.message-attachments');
				expect(attachments).not.toBeNull();
				expect(attachments!.textContent).toContain('second.md');
				done();
			}, 100);
		}, 100);
	});

	it('shows file attachments under force-pushed message', (done) => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		const file = new File(['urgent data'], 'urgent.json', { type: 'application/json' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			promptInput.value = 'Urgent with file';
			pressKey(promptInput, 'Enter');

			const forceBtn = document.querySelector('.queue-item-force') as HTMLButtonElement;
			forceBtn.click();

			const userMessages = document.querySelectorAll('.message-user');
			const forcedMsg = userMessages[userMessages.length - 1] as HTMLElement;
			const attachments = forcedMsg.querySelector('.message-attachments');
			expect(attachments).not.toBeNull();
			expect(attachments!.textContent).toContain('urgent.json');
			done();
		}, 100);
	});
});

describe('panel.js context chars chip', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('shows selection length when selectionInfo has active selection', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'selectionInfo', hasSelection: true, length: 42 });

		const chip = document.getElementById('contextCharsChip');
		expect(chip).not.toBeNull();
		expect(chip!.textContent).toContain('Selection');
		expect(chip!.textContent).toContain('42');
	});

	it('falls back to note body length when selection is cleared', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteInfo', noteId: 'n1', title: 'T', bodyLength: 300 });
		messageHandler({ type: 'selectionInfo', hasSelection: true, length: 10 });
		expect(document.getElementById('contextCharsChip')!.textContent).toContain('Selection');

		messageHandler({ type: 'selectionInfo', hasSelection: false, length: 0 });
		const chip = document.getElementById('contextCharsChip');
		expect(chip).not.toBeNull();
		expect(chip!.textContent).toContain('Note');
		expect(chip!.textContent).toContain('300');
	});

	it('shows note body length from noteInfo when no selection', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteInfo', noteId: 'n1', title: 'Test', bodyLength: 1500 });

		const chip = document.getElementById('contextCharsChip');
		expect(chip).not.toBeNull();
		expect(chip!.textContent).toContain('Note');
		expect(chip!.textContent).toContain('2k');
	});

	it('shows abbreviated count for large selections', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'selectionInfo', hasSelection: true, length: 5200 });

		const chip = document.getElementById('contextCharsChip');
		expect(chip).not.toBeNull();
		expect(chip!.textContent).toContain('5k');
	});

	it('updates existing chip when selection changes', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'selectionInfo', hasSelection: true, length: 10 });
		messageHandler({ type: 'selectionInfo', hasSelection: true, length: 200 });

		const chips = document.querySelectorAll('#contextCharsChip');
		expect(chips.length).toBe(1);
		expect(chips[0].textContent).toContain('200');
	});

	it('removes chip when no note and no selection', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteInfo', noteId: null, title: null, bodyLength: 0 });
		messageHandler({ type: 'selectionInfo', hasSelection: false, length: 0 });

		expect(document.getElementById('contextCharsChip')).toBeNull();
	});

	it('applies selection CSS modifier class when selection is active', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'selectionInfo', hasSelection: true, length: 50 });

		const chip = document.getElementById('contextCharsChip');
		expect(chip!.classList.contains('context-chip--selection')).toBe(true);
	});

	it('does not apply selection CSS modifier when showing note body', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteInfo', noteId: 'n1', title: 'T', bodyLength: 100 });

		const chip = document.getElementById('contextCharsChip');
		expect(chip!.classList.contains('context-chip--selection')).toBe(false);
	});

	it('shows clear button on chip when selection is active', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'selectionInfo', hasSelection: true, length: 50 });

		const chip = document.getElementById('contextCharsChip');
		const clearBtn = chip!.querySelector('.context-chip-clear');
		expect(clearBtn).not.toBeNull();
	});

	it('does not show clear button on chip when showing note body', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteInfo', noteId: 'n1', title: 'T', bodyLength: 100 });

		const chip = document.getElementById('contextCharsChip');
		const clearBtn = chip!.querySelector('.context-chip-clear');
		expect(clearBtn).toBeNull();
	});

	it('sends clearSelection message when clear button is clicked', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'selectionInfo', hasSelection: true, length: 50 });

		const chip = document.getElementById('contextCharsChip');
		const clearBtn = chip!.querySelector('.context-chip-clear') as HTMLButtonElement;
		clearBtn.click();

		expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'clearSelection' });
	});

	it('resets chip to note body display after clear button click and selectionInfo reset', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'noteInfo', noteId: 'n1', title: 'T', bodyLength: 500 });
		messageHandler({ type: 'selectionInfo', hasSelection: true, length: 50 });

		const chip = document.getElementById('contextCharsChip');
		expect(chip!.textContent).toContain('Selection');

		const clearBtn = chip!.querySelector('.context-chip-clear') as HTMLButtonElement;
		clearBtn.click();

		messageHandler({ type: 'selectionInfo', hasSelection: false, length: 0 });

		const updatedChip = document.getElementById('contextCharsChip');
		expect(updatedChip!.textContent).toContain('Note');
		expect(updatedChip!.textContent).toContain('500');
		expect(updatedChip!.querySelector('.context-chip-clear')).toBeNull();
	});
});

describe('panel.js context size circle', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('renders context size circle when contextSize message is received', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'contextSize',
			usedTokens: 5000,
			maxTokens: 128000,
			percentage: 3.9,
		});

		const container = document.getElementById('contextSizeContainer') as HTMLElement;
		expect(container.querySelector('svg')).not.toBeNull();
	});

	it('displays percentage text inside the circle', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'contextSize',
			usedTokens: 64000,
			maxTokens: 128000,
			percentage: 50,
		});

		const container = document.getElementById('contextSizeContainer') as HTMLElement;
		const textEl = container.querySelector('.context-size-text');
		expect(textEl).not.toBeNull();
		expect(textEl!.textContent).toContain('50');
	});

	it('shows tooltip with token details', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'contextSize',
			usedTokens: 5000,
			maxTokens: 128000,
			percentage: 3.9,
		});

		const container = document.getElementById('contextSizeContainer') as HTMLElement;
		const title = container.getAttribute('title');
		expect(title).toContain('5000');
		expect(title).toContain('128000');
	});

	it('updates circle when new contextSize message arrives', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'contextSize',
			usedTokens: 5000,
			maxTokens: 128000,
			percentage: 3.9,
		});

		messageHandler({
			type: 'contextSize',
			usedTokens: 100000,
			maxTokens: 128000,
			percentage: 78.1,
		});

		const container = document.getElementById('contextSizeContainer') as HTMLElement;
		const textEl = container.querySelector('.context-size-text');
		expect(textEl!.textContent).toContain('78');
	});

	it('uses green color for low usage (under 60%)', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'contextSize',
			usedTokens: 5000,
			maxTokens: 128000,
			percentage: 3.9,
		});

		const container = document.getElementById('contextSizeContainer') as HTMLElement;
		const circle = container.querySelector('.context-size-progress') as SVGCircleElement;
		expect(circle).not.toBeNull();
		expect(circle.getAttribute('stroke')).toBe('#22c55e');
	});

	it('uses orange color for medium usage (60-85%)', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'contextSize',
			usedTokens: 90000,
			maxTokens: 128000,
			percentage: 70.3,
		});

		const container = document.getElementById('contextSizeContainer') as HTMLElement;
		const circle = container.querySelector('.context-size-progress') as SVGCircleElement;
		expect(circle.getAttribute('stroke')).toBe('#f59e0b');
	});

	it('uses red color for high usage (over 85%)', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'contextSize',
			usedTokens: 120000,
			maxTokens: 128000,
			percentage: 93.8,
		});

		const container = document.getElementById('contextSizeContainer') as HTMLElement;
		const circle = container.querySelector('.context-size-progress') as SVGCircleElement;
		expect(circle.getAttribute('stroke')).toBe('#ef4444');
	});

	it('handles 0% usage gracefully', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'contextSize',
			usedTokens: 0,
			maxTokens: 128000,
			percentage: 0,
		});

		const container = document.getElementById('contextSizeContainer') as HTMLElement;
		expect(container.querySelector('svg')).not.toBeNull();
		const textEl = container.querySelector('.context-size-text');
		expect(textEl!.textContent).toContain('0');
	});

	it('handles 100% usage gracefully', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'contextSize',
			usedTokens: 128000,
			maxTokens: 128000,
			percentage: 100,
		});

		const container = document.getElementById('contextSizeContainer') as HTMLElement;
		const textEl = container.querySelector('.context-size-text');
		expect(textEl!.textContent).toContain('100');
	});
});

describe('panel.js message queue', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('queues a message when AI is already processing', () => {
		promptInput.value = 'First message';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Second message';
		pressKey(promptInput, 'Enter');

		const queueContainer = document.getElementById('queueContainer') as HTMLElement;
		expect(queueContainer).not.toBeNull();
		const queueItems = queueContainer.querySelectorAll('.queue-item');
		expect(queueItems.length).toBe(1);
		expect(queueItems[0].textContent).toContain('Second message');
	});

	it('clears input after queuing a message', () => {
		promptInput.value = 'First message';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued message';
		pressKey(promptInput, 'Enter');

		expect(promptInput.value).toBe('');
	});

	it('does not send queued message to plugin immediately', () => {
		promptInput.value = 'First message';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued message';
		pressKey(promptInput, 'Enter');

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(1);
		expect(executeCalls[0][0].prompt).toBe('First message');
	});

	it('auto-sends next queued message when AI response arrives', () => {
		promptInput.value = 'First message';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Second message';
		pressKey(promptInput, 'Enter');

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'result', content: 'Reply 1', isEdit: false, actions: [] });

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(2);
		expect(executeCalls[1][0].prompt).toBe('Second message');
	});

	it('processes multiple queued messages sequentially', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Second';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Third';
		pressKey(promptInput, 'Enter');

		messageHandler({ type: 'result', content: 'Reply 1', isEdit: false, actions: [] });

		let executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(2);
		expect(executeCalls[1][0].prompt).toBe('Second');

		messageHandler({ type: 'result', content: 'Reply 2', isEdit: false, actions: [] });

		executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(3);
		expect(executeCalls[2][0].prompt).toBe('Third');
	});

	it('removes queue item from UI after it is sent', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Second';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Third';
		pressKey(promptInput, 'Enter');

		const queueContainer = document.getElementById('queueContainer') as HTMLElement;
		expect(queueContainer.querySelectorAll('.queue-item').length).toBe(2);

		messageHandler({ type: 'result', content: 'Reply 1', isEdit: false, actions: [] });
		expect(queueContainer.querySelectorAll('.queue-item').length).toBe(1);

		messageHandler({ type: 'result', content: 'Reply 2', isEdit: false, actions: [] });
		expect(queueContainer.querySelectorAll('.queue-item').length).toBe(0);
	});

	it('shows queue item with edit, delete, and force push buttons', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued';
		pressKey(promptInput, 'Enter');

		const queueItem = document.querySelector('.queue-item') as HTMLElement;
		expect(queueItem).not.toBeNull();
		expect(queueItem.querySelector('.queue-item-edit')).not.toBeNull();
		expect(queueItem.querySelector('.queue-item-delete')).not.toBeNull();
		expect(queueItem.querySelector('.queue-item-force')).not.toBeNull();
	});

	it('deletes queue item when delete button is clicked', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'To be deleted';
		pressKey(promptInput, 'Enter');

		const deleteBtn = document.querySelector('.queue-item-delete') as HTMLButtonElement;
		deleteBtn.click();

		const queueContainer = document.getElementById('queueContainer') as HTMLElement;
		expect(queueContainer.querySelectorAll('.queue-item').length).toBe(0);
	});

	it('moves queue item content to input when edit button is clicked', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Edit this message';
		pressKey(promptInput, 'Enter');

		const editBtn = document.querySelector('.queue-item-edit') as HTMLButtonElement;
		editBtn.click();

		expect(promptInput.value).toBe('Edit this message');
		const queueContainer = document.getElementById('queueContainer') as HTMLElement;
		expect(queueContainer.querySelectorAll('.queue-item').length).toBe(0);
	});

	it('force push interrupts current request and sends forced message', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Urgent message';
		pressKey(promptInput, 'Enter');

		const forceBtn = document.querySelector('.queue-item-force') as HTMLButtonElement;
		forceBtn.click();

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls.length).toBeGreaterThanOrEqual(2);
		const lastExecute = executeCalls[executeCalls.length - 1];
		expect(lastExecute[0].prompt).toBe('Urgent message');
	});

	it('force push removes the item from the queue', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Urgent';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Third in queue';
		pressKey(promptInput, 'Enter');

		const queueContainer = document.getElementById('queueContainer') as HTMLElement;
		expect(queueContainer.querySelectorAll('.queue-item').length).toBe(2);

		const forceBtn = queueContainer.querySelector('.queue-item-force') as HTMLButtonElement;
		forceBtn.click();

		expect(queueContainer.querySelectorAll('.queue-item').length).toBe(1);
	});

	it('shows user message in chat when queued message is sent', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued message';
		pressKey(promptInput, 'Enter');

		messageHandler({ type: 'result', content: 'Reply 1', isEdit: false, actions: [] });

		const userMessages = document.querySelectorAll('.message-user');
		const userTexts = Array.from(userMessages).map((m) => m.textContent);
		expect(userTexts.some((t) => t!.includes('Queued message'))).toBe(true);
	});

	it('sends queued message with current workMode', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		modeSelect.value = 'edit';
		modeSelect.dispatchEvent(new Event('change'));

		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued in edit mode';
		pressKey(promptInput, 'Enter');

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'result', content: 'Reply', isEdit: false, actions: [] });

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		const queuedCall = executeCalls[executeCalls.length - 1];
		expect(queuedCall[0].workMode).toBe('edit');
	});

	it('processes queue after error response', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued';
		pressKey(promptInput, 'Enter');

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'error', message: 'Something failed' });

		const queueContainer = document.getElementById('queueContainer') as HTMLElement;
		expect(queueContainer.querySelectorAll('.queue-item').length).toBe(0);

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCalls).toHaveLength(2);
	});

	it('clears queue when clear history button is clicked', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued 1';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued 2';
		pressKey(promptInput, 'Enter');

		const clearHistoryBtn = document.getElementById('clearHistoryBtn') as HTMLButtonElement;
		clearHistoryBtn.click();

		const queueContainer = document.getElementById('queueContainer') as HTMLElement;
		expect(queueContainer.querySelectorAll('.queue-item').length).toBe(0);
	});

	it('shows queue item text truncated for long messages', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		const longMessage = 'A'.repeat(200);
		promptInput.value = longMessage;
		pressKey(promptInput, 'Enter');

		const queueText = document.querySelector('.queue-item-text') as HTMLElement;
		expect(queueText).not.toBeNull();
		expect(queueText.textContent!.length).toBeLessThan(200);
	});

	it('shows queue position number on each queued item', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Second';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Third';
		pressKey(promptInput, 'Enter');

		const queuePositions = document.querySelectorAll('.queue-item-position');
		expect(queuePositions.length).toBe(2);
		expect(queuePositions[0].textContent).toContain('1');
		expect(queuePositions[1].textContent).toContain('2');
	});

	it('includes history from previous exchanges when sending queued message', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued';
		pressKey(promptInput, 'Enter');

		messageHandler({ type: 'result', content: 'Reply 1', isEdit: false, actions: [] });

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		const queuedCall = executeCalls[executeCalls.length - 1];
		expect(queuedCall[0].history).toEqual([
			{ role: 'user', content: 'First' },
			{ role: 'assistant', content: 'Reply 1' },
		]);
	});

	it('force push sends abortRequest before executing', () => {
		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Urgent';
		pressKey(promptInput, 'Enter');

		const forceBtn = document.querySelector('.queue-item-force') as HTMLButtonElement;
		forceBtn.click();

		const abortCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'abortRequest',
		);
		expect(abortCalls.length).toBeGreaterThanOrEqual(1);
	});

	it('resumes normal processing after force push completes', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'First';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Urgent';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'After urgent';
		pressKey(promptInput, 'Enter');

		const forceBtn = document.querySelector('.queue-item-force') as HTMLButtonElement;
		forceBtn.click();

		messageHandler({ type: 'result', content: 'Stale first reply', isEdit: false, actions: [] });

		messageHandler({ type: 'result', content: 'Urgent reply', isEdit: false, actions: [] });

		const executeCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'execute',
		);
		const lastCall = executeCalls[executeCalls.length - 1];
		expect(lastCall[0].prompt).toBe('After urgent');
	});
});

describe('panel.js per-message model label', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('shows model name label on AI message when modelName is provided', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'result',
			content: 'Hello!',
			isEdit: false,
			actions: [],
			modelName: 'GPT-4o',
		});

		const aiMessage = document.querySelector('.message-ai') as HTMLElement;
		expect(aiMessage).not.toBeNull();
		const modelLabel = aiMessage.querySelector('.message-model-label') as HTMLElement;
		expect(modelLabel).not.toBeNull();
		expect(modelLabel.textContent).toBe('GPT-4o');
	});

	it('does not show model label when modelName is not provided', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'result',
			content: 'Hello!',
			isEdit: false,
			actions: [],
		});

		const aiMessage = document.querySelector('.message-ai') as HTMLElement;
		expect(aiMessage).not.toBeNull();
		const modelLabel = aiMessage.querySelector('.message-model-label');
		expect(modelLabel).toBeNull();
	});

	it('does not show model label on user messages', () => {
		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'Hello';
		pressKey(promptInput, 'Enter');

		const userMessage = document.querySelector('.message-user') as HTMLElement;
		expect(userMessage).not.toBeNull();
		const modelLabel = userMessage.querySelector('.message-model-label');
		expect(modelLabel).toBeNull();
	});

	it('does not request getModelInfo on initialization (removed)', () => {
		const getModelInfoCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'getModelInfo',
		);
		expect(getModelInfoCalls).toHaveLength(0);
	});

	it('does not have a modelIndicator element in the DOM', () => {
		const modelIndicator = document.getElementById('modelIndicator');
		expect(modelIndicator).toBeNull();
	});
});

describe('panel.js markdown rendering in AI messages', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('renders bold text in AI messages as <strong>', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'result',
			content: 'This is **important** info',
			isEdit: false,
			actions: [],
		});

		const aiMessage = document.querySelector('.message-ai') as HTMLElement;
		expect(aiMessage).not.toBeNull();
		expect(aiMessage.querySelector('strong')).not.toBeNull();
		expect(aiMessage.querySelector('strong')!.textContent).toBe('important');
	});

	it('renders inline code in AI messages as <code>', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'result',
			content: 'Use `console.log()` for debug',
			isEdit: false,
			actions: [],
		});

		const aiMessage = document.querySelector('.message-ai') as HTMLElement;
		expect(aiMessage.querySelector('code')).not.toBeNull();
		expect(aiMessage.querySelector('code')!.textContent).toBe('console.log()');
	});

	it('renders code blocks in AI messages as <pre><code>', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'result',
			content: '```javascript\nconst x = 1;\n```',
			isEdit: false,
			actions: [],
		});

		const aiMessage = document.querySelector('.message-ai') as HTMLElement;
		expect(aiMessage.querySelector('pre')).not.toBeNull();
		expect(aiMessage.querySelector('pre code')).not.toBeNull();
	});

	it('renders unordered lists in AI messages', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'result',
			content: 'Steps:\n\n- Step 1\n- Step 2\n- Step 3',
			isEdit: false,
			actions: [],
		});

		const aiMessage = document.querySelector('.message-ai') as HTMLElement;
		expect(aiMessage.querySelector('ul')).not.toBeNull();
		expect(aiMessage.querySelectorAll('li').length).toBe(3);
	});

	it('renders links in AI messages with target="_blank"', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'result',
			content: 'Visit [Google](https://google.com)',
			isEdit: false,
			actions: [],
		});

		const aiMessage = document.querySelector('.message-ai') as HTMLElement;
		const link = aiMessage.querySelector('a') as HTMLAnchorElement;
		expect(link).not.toBeNull();
		expect(link.href).toContain('google.com');
		expect(link.target).toBe('_blank');
	});

	it('does NOT render markdown in user messages (keeps plain text)', () => {
		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'This is **bold** text';
		pressKey(promptInput, 'Enter');

		const userMessage = document.querySelector('.message-user') as HTMLElement;
		expect(userMessage).not.toBeNull();
		expect(userMessage.querySelector('strong')).toBeNull();
		expect(userMessage.textContent).toContain('**bold**');
	});

	it('escapes HTML in AI messages to prevent XSS', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'result',
			content: 'Hello <script>alert("xss")</script>',
			isEdit: false,
			actions: [],
		});

		const aiMessage = document.querySelector('.message-ai') as HTMLElement;
		expect(aiMessage.querySelector('script')).toBeNull();
	});

	it('adds markdown-content class to AI message content div', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'result',
			content: 'Some **markdown** content',
			isEdit: false,
			actions: [],
		});

		const aiMessage = document.querySelector('.message-ai') as HTMLElement;
		expect(aiMessage.querySelector('.markdown-content')).not.toBeNull();
	});

	it('does not add markdown-content class to user message content', () => {
		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'Hello';
		pressKey(promptInput, 'Enter');

		const userMessage = document.querySelector('.message-user') as HTMLElement;
		expect(userMessage.querySelector('.markdown-content')).toBeNull();
	});
});

describe('panel.js chat persistence across settings navigation', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;

	beforeEach(() => {
		localStorage.clear();
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
		localStorage.clear();
	});

	it('saves chatHistory to localStorage after a completed exchange', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'Hello';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'result', content: 'Hi there!', isEdit: false, actions: [] });

		const stored = localStorage.getItem('joplin-ai-chat-history');
		expect(stored).not.toBeNull();
		const parsed = JSON.parse(stored!);
		expect(parsed).toEqual([
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
		]);
	});

	it('restores chatHistory from localStorage on reinitialisation (simulates return from settings)', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'Hello';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'result', content: 'Hi there!', isEdit: false, actions: [] });

		// Simulate returning from settings: rebuild DOM and re-init (localStorage is preserved)
		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const promptInput2 = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput2.value = 'Follow-up question';
		promptInput2.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const executeCall = mockApi2.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCall).toBeDefined();
		expect(executeCall![0].history).toEqual([
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
		]);
	});

	it('restores visible chat messages in the DOM on reinitialisation', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'Hello';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'result', content: 'Hi there!', isEdit: false, actions: [] });

		// Simulate returning from settings
		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const messagesEl = document.getElementById('messages') as HTMLElement;
		expect(messagesEl.querySelector('.message-user')).not.toBeNull();
		expect(messagesEl.querySelector('.message-ai')).not.toBeNull();
		expect(messagesEl.textContent).toContain('Hello');
		expect(messagesEl.textContent).toContain('Hi there!');
	});

	it('hides empty state after restoring messages from storage', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'Hello';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'result', content: 'Reply', isEdit: false, actions: [] });

		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const emptyState = document.getElementById('emptyState') as HTMLElement;
		expect(emptyState.style.display).toBe('none');
	});

	it('clears localStorage when clear history button is clicked', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		promptInput.value = 'Hello';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'result', content: 'Hi!', isEdit: false, actions: [] });

		const clearHistoryBtn = document.getElementById('clearHistoryBtn') as HTMLButtonElement;
		clearHistoryBtn.click();

		const stored = localStorage.getItem('joplin-ai-chat-history');
		expect(stored).toBeNull();
	});

	it('restores empty chat when localStorage has no saved history', () => {
		localStorage.clear();

		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const messagesEl = document.getElementById('messages') as HTMLElement;
		expect(messagesEl.querySelector('.message')).toBeNull();
		const emptyState = document.getElementById('emptyState') as HTMLElement;
		expect(emptyState.style.display).not.toBe('none');
	});

	it('persists selected work mode to localStorage', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		modeSelect.value = 'ask';
		modeSelect.dispatchEvent(new Event('change'));

		const stored = localStorage.getItem('joplin-ai-mode');
		expect(stored).toBe('ask');
	});

	it('restores work mode from localStorage on reinitialisation', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		modeSelect.value = 'edit';
		modeSelect.dispatchEvent(new Event('change'));

		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const modeSelect2 = document.getElementById('modeSelect') as HTMLSelectElement;
		expect(modeSelect2.value).toBe('edit');
	});

	it('sends restored workMode on execute after reinitialisation', () => {
		const modeSelect = document.getElementById('modeSelect') as HTMLSelectElement;
		modeSelect.value = 'ask';
		modeSelect.dispatchEvent(new Event('change'));

		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const promptInput2 = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput2.value = 'Hello';
		promptInput2.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const executeCall = mockApi2.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCall![0].workMode).toBe('ask');
	});

	it('persists applied role to localStorage when role is applied', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You are a coding expert' }],
		});

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		roleSelect.value = 'r1';
		const applyBtn = document.getElementById('applyRoleBtn') as HTMLButtonElement;
		applyBtn.click();

		const stored = localStorage.getItem('joplin-ai-applied-role');
		expect(stored).not.toBeNull();
		const parsed = JSON.parse(stored!);
		expect(parsed).toMatchObject({
			id: 'r1',
			name: 'Coder',
			systemPrompt: 'You are a coding expert',
		});
	});

	it('persists null to localStorage when no role is applied', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		roleSelect.value = 'r1';
		document.getElementById('applyRoleBtn')!.click();

		roleSelect.value = '';
		document.getElementById('applyRoleBtn')!.click();

		const stored = localStorage.getItem('joplin-ai-applied-role');
		expect(stored).toBeNull();
	});

	it('restores applied role indicator from localStorage on reinitialisation', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You are a coding expert' }],
		});

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		roleSelect.value = 'r1';
		document.getElementById('applyRoleBtn')!.click();

		// Simulate returning from settings
		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const indicator = document.querySelector('.role-active-indicator');
		expect(indicator).not.toBeNull();
		expect(indicator!.textContent).toContain('Coder');
	});

	it('sends agentRolePrompt in execute after restoring role from localStorage', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You are a coding expert' }],
		});

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		roleSelect.value = 'r1';
		document.getElementById('applyRoleBtn')!.click();

		// Simulate returning from settings
		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const promptInput2 = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput2.value = 'Write some code';
		promptInput2.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);

		const executeCall = mockApi2.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'execute',
		);
		expect(executeCall).toBeDefined();
		expect(executeCall![0].agentRolePrompt).toBe('You are a coding expert');
	});

	it('restores role select value when agentRoles message arrives after reinitialisation', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		roleSelect.value = 'r1';
		document.getElementById('applyRoleBtn')!.click();

		// Simulate returning from settings
		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		// Now the backend sends agentRoles (simulating panel reload)
		const messageHandler2 = mockApi2.onMessage.mock.calls[0][0];
		messageHandler2({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const roleSelect2 = document.getElementById('roleSelect') as HTMLSelectElement;
		expect(roleSelect2.value).toBe('r1');
	});

	it('clearing history does not clear persisted applied role', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		roleSelect.value = 'r1';
		document.getElementById('applyRoleBtn')!.click();

		// Add a message so history is populated
		promptInput.value = 'Hello';
		promptInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
		);
		messageHandler({ type: 'result', content: 'Hi!', isEdit: false, actions: [] });

		// Clear history
		document.getElementById('clearHistoryBtn')!.click();

		const stored = localStorage.getItem('joplin-ai-applied-role');
		expect(stored).not.toBeNull();
		const parsed = JSON.parse(stored!);
		expect(parsed).toMatchObject({ id: 'r1', name: 'Coder' });
	});
});

describe('panel.js role persistence via backend settings', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('sends saveAppliedRoleId to backend when a role is applied', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		roleSelect.value = 'r1';
		document.getElementById('applyRoleBtn')!.click();

		const saveCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'saveAppliedRoleId',
		);
		expect(saveCall).toBeDefined();
		expect(saveCall![0].roleId).toBe('r1');
	});

	it('sends saveAppliedRoleId with null when role is cleared', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		roleSelect.value = 'r1';
		document.getElementById('applyRoleBtn')!.click();

		roleSelect.value = '';
		document.getElementById('applyRoleBtn')!.click();

		const saveCalls = mockApi.postMessage.mock.calls.filter(
			(call: any[]) => call[0]?.type === 'saveAppliedRoleId',
		);
		expect(saveCalls.length).toBeGreaterThanOrEqual(2);
		expect(saveCalls[saveCalls.length - 1][0].roleId).toBeNull();
	});

	it('restores applied role from appliedRoleId in agentRoles message', () => {
		localStorage.clear();

		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const messageHandler = mockApi2.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [
				{ id: 'r1', name: 'Coder', systemPrompt: 'You code' },
				{ id: 'r2', name: 'Writer', systemPrompt: 'You write' },
			],
			appliedRoleId: 'r2',
		});

		const indicator = document.querySelector('.role-active-indicator');
		expect(indicator).not.toBeNull();
		expect(indicator!.textContent).toContain('Writer');

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		expect(roleSelect.value).toBe('r2');
	});

	it('sends saveAppliedRoleId with null when deleting the applied role', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const roleSelect = document.getElementById('roleSelect') as HTMLSelectElement;
		roleSelect.value = 'r1';
		document.getElementById('applyRoleBtn')!.click();

		const manageView = document.getElementById('roleManageView') as HTMLElement;
		manageView.style.display = '';
		document.getElementById('manageRolesBtn')!.click();

		mockApi.postMessage.mockClear();

		const deleteBtn = document.querySelector('.delete-role-btn') as HTMLButtonElement;
		expect(deleteBtn).not.toBeNull();
		deleteBtn.click();

		const saveCall = mockApi.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'saveAppliedRoleId',
		);
		expect(saveCall).toBeDefined();
		expect(saveCall![0].roleId).toBeNull();
	});

	it('migrates localStorage role to backend when appliedRoleId is absent from agentRoles', () => {
		localStorage.setItem(
			'joplin-ai-applied-role',
			JSON.stringify({ id: 'r1', name: 'Coder', systemPrompt: 'You code' }),
		);

		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const messageHandler = mockApi2.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const saveCall = mockApi2.postMessage.mock.calls.find(
			(call: any[]) => call[0]?.type === 'saveAppliedRoleId',
		);
		expect(saveCall).toBeDefined();
		expect(saveCall![0].roleId).toBe('r1');
	});

	it('clears stale localStorage role when it no longer exists in agentRoles', () => {
		localStorage.setItem(
			'joplin-ai-applied-role',
			JSON.stringify({ id: 'deleted', name: 'Gone', systemPrompt: 'old' }),
		);

		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const messageHandler = mockApi2.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }],
		});

		const indicator = document.querySelector('.role-active-indicator');
		expect(indicator).toBeNull();
		expect(localStorage.getItem('joplin-ai-applied-role')).toBeNull();
	});

	it('does not restore role from localStorage when backend provides appliedRoleId', () => {
		localStorage.setItem(
			'joplin-ai-applied-role',
			JSON.stringify({ id: 'old', name: 'Old', systemPrompt: 'old prompt' }),
		);

		delete (window as any).webviewApi;
		buildDOM();
		const mockApi2 = createMockWebviewApi();
		initPanel(mockApi2);

		const messageHandler = mockApi2.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'agentRoles',
			roles: [
				{ id: 'r1', name: 'Coder', systemPrompt: 'You code' },
				{ id: 'r2', name: 'Writer', systemPrompt: 'You write' },
			],
			appliedRoleId: 'r2',
		});

		const indicator = document.querySelector('.role-active-indicator');
		expect(indicator).not.toBeNull();
		expect(indicator!.textContent).toContain('Writer');
	});
});

describe('panel.js image generation progress bar', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('shows progress bar when imageProgress message is received', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'imageProgress',
			progress: 10,
			state: 'generating',
		});

		const progressBar = document.getElementById('imageProgressBar') as HTMLElement;
		expect(progressBar).not.toBeNull();
	});

	it('displays state label with percentage in the progress bar', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'imageProgress',
			progress: 42,
			state: 'generating',
		});

		const progressBar = document.getElementById('imageProgressBar') as HTMLElement;
		expect(progressBar).not.toBeNull();
		const label = progressBar.querySelector('.image-progress-label') as HTMLElement;
		expect(label).not.toBeNull();
		expect(label.textContent!.toLowerCase()).toContain('generat');
		expect(label.textContent).toContain('42');
	});

	it('updates state label when new imageProgress message arrives', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'imageProgress',
			progress: 20,
			state: 'queuing',
		});

		messageHandler({
			type: 'imageProgress',
			progress: 60,
			state: 'generating',
		});

		const progressBar = document.getElementById('imageProgressBar') as HTMLElement;
		expect(progressBar).not.toBeNull();
		const label = progressBar.querySelector('.image-progress-label') as HTMLElement;
		expect(label.textContent!.toLowerCase()).toContain('generat');
	});

	it('shows state label in the progress bar', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'imageProgress',
			progress: 10,
			state: 'queuing',
		});

		const progressBar = document.getElementById('imageProgressBar') as HTMLElement;
		expect(progressBar).not.toBeNull();
		expect(progressBar.textContent!.toLowerCase()).toContain('queu');
	});

	it('hides progress bar when imageProgress with done state is received', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'imageProgress',
			progress: 50,
			state: 'generating',
		});

		expect(document.getElementById('imageProgressBar')).not.toBeNull();

		messageHandler({
			type: 'imageProgress',
			progress: 100,
			state: 'done',
		});

		expect(document.getElementById('imageProgressBar')).toBeNull();
	});

	it('hides progress bar when result message is received', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'imageProgress',
			progress: 75,
			state: 'generating',
		});

		expect(document.getElementById('imageProgressBar')).not.toBeNull();

		messageHandler({
			type: 'result',
			content: 'Image generated!',
			isEdit: false,
			actions: [],
		});

		expect(document.getElementById('imageProgressBar')).toBeNull();
	});

	it('hides progress bar when error message is received', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'imageProgress',
			progress: 30,
			state: 'generating',
		});

		expect(document.getElementById('imageProgressBar')).not.toBeNull();

		messageHandler({ type: 'error', message: 'Generation failed' });

		expect(document.getElementById('imageProgressBar')).toBeNull();
	});

	it('renders a progress fill element with inline width matching percentage', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({
			type: 'imageProgress',
			progress: 55,
			state: 'generating',
		});

		const fill = document.querySelector('.image-progress-fill') as HTMLElement;
		expect(fill).not.toBeNull();
		expect(fill.style.width).toBe('55%');
	});
});

describe('panel.js PDF base64 fallback', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let promptInput: HTMLTextAreaElement;
	let fileInput: HTMLInputElement;
	let fileChips: HTMLElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		fileInput = document.getElementById('fileInput') as HTMLInputElement;
		fileChips = document.getElementById('fileChips') as HTMLElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('sends base64Data when PDF text extraction returns empty', (done) => {
		(window as any).extractPdfText = () => '';
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
		const file = new File([pdfBytes], 'compressed.pdf', { type: 'application/pdf' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const chips = fileChips.querySelectorAll('.file-chip');
			expect(chips.length).toBe(1);
			expect(chips[0].textContent).toContain('compressed.pdf');
			promptInput.value = 'Read this PDF';
			pressKey(promptInput, 'Enter');
			const executeCall = mockApi.postMessage.mock.calls.find(
				(call: any[]) => call[0]?.type === 'execute',
			);
			expect(executeCall).toBeDefined();
			const attachedFiles = executeCall![0].attachedFiles;
			expect(attachedFiles).toHaveLength(1);
			expect(attachedFiles[0].name).toBe('compressed.pdf');
			expect(attachedFiles[0].base64Data).toBeTruthy();
			expect(typeof attachedFiles[0].base64Data).toBe('string');
			done();
		}, 200);
	});

	it('does NOT show error message when PDF text extraction fails', (done) => {
		(window as any).extractPdfText = () => '';
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
		const file = new File([pdfBytes], 'nodeerror.pdf', { type: 'application/pdf' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const errorMsg = document.querySelector('.message-error');
			expect(errorMsg).toBeNull();
			done();
		}, 200);
	});

	it('sends extracted text (no base64Data) when PDF text extraction succeeds', (done) => {
		(window as any).extractPdfText = () => 'Extracted PDF text';
		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
		const file = new File([pdfBytes], 'readable.pdf', { type: 'application/pdf' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			promptInput.value = 'Analyze';
			pressKey(promptInput, 'Enter');
			const executeCall = mockApi.postMessage.mock.calls.find(
				(call: any[]) => call[0]?.type === 'execute',
			);
			const attachedFiles = executeCall![0].attachedFiles;
			expect(attachedFiles).toHaveLength(1);
			expect(attachedFiles[0].content).toBe('Extracted PDF text');
			expect(attachedFiles[0].base64Data).toBeUndefined();
			done();
		}, 200);
	});
});

describe('panel.js configurable file size limit', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let fileInput: HTMLInputElement;
	let fileChips: HTMLElement;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		fileInput = document.getElementById('fileInput') as HTMLInputElement;
		fileChips = document.getElementById('fileChips') as HTMLElement;
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('requests file size limit on initialization', () => {
		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'getFileSizeLimit' }),
		);
	});

	it('uses 10 MB default limit before any fileSizeLimit message', (done) => {
		const bigFile = new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], 'huge.txt', {
			type: 'text/plain',
		});
		Object.defineProperty(fileInput, 'files', {
			value: [bigFile],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const errorMsg = document.querySelector('.message-error');
			expect(errorMsg).not.toBeNull();
			expect(errorMsg!.textContent).toContain('exceeds');
			expect(errorMsg!.textContent).toContain('10');
			done();
		}, 100);
	});

	it('accepts files within the 10 MB default limit', (done) => {
		const okFile = new File(['x'.repeat(100)], 'small.txt', { type: 'text/plain' });
		Object.defineProperty(fileInput, 'files', {
			value: [okFile],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const chips = fileChips.querySelectorAll('.file-chip');
			expect(chips.length).toBe(1);
			done();
		}, 100);
	});

	it('updates file size limit when fileSizeLimit message is received', (done) => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'fileSizeLimit', limitBytes: 500 * 1024 });

		const bigFile = new File([new ArrayBuffer(501 * 1024)], 'medium.txt', {
			type: 'text/plain',
		});
		Object.defineProperty(fileInput, 'files', {
			value: [bigFile],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const errorMsg = document.querySelector('.message-error');
			expect(errorMsg).not.toBeNull();
			expect(errorMsg!.textContent).toContain('exceeds');
			done();
		}, 100);
	});

	it('shows human-readable size in error message for MB limits', (done) => {
		const bigFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'big.pdf', {
			type: 'application/pdf',
		});
		Object.defineProperty(fileInput, 'files', {
			value: [bigFile],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const errorMsg = document.querySelector('.message-error');
			expect(errorMsg).not.toBeNull();
			expect(errorMsg!.textContent).toContain('10 MB');
			done();
		}, 100);
	});

	it('allows large file after limit is increased via setting', (done) => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'fileSizeLimit', limitBytes: 50 * 1024 * 1024 });

		const bigFile = new File(['x'.repeat(1000)], 'large.txt', { type: 'text/plain' });
		Object.defineProperty(fileInput, 'files', {
			value: [bigFile],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));
		setTimeout(() => {
			const chips = fileChips.querySelectorAll('.file-chip');
			expect(chips.length).toBe(1);
			const errorMsg = document.querySelector('.message-error');
			expect(errorMsg).toBeNull();
			done();
		}, 100);
	});
});

describe('thinkingStep message handling', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let messageHandler: (msg: unknown) => void;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'loading', status: true });
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('updates loading indicator text when thinkingStep message is received', () => {
		messageHandler({ type: 'thinkingStep', step: 'search_notes', label: 'Searching notes...' });

		const loadingEl = document.getElementById('loadingIndicator');
		expect(loadingEl).not.toBeNull();
		expect(loadingEl!.textContent).toContain('Searching notes...');
	});

	it('updates loading indicator text for a different step', () => {
		messageHandler({ type: 'thinkingStep', step: 'create_note', label: 'Creating note...' });

		const loadingEl = document.getElementById('loadingIndicator');
		expect(loadingEl!.textContent).toContain('Creating note...');
	});

	it('does not crash if thinkingStep message arrives when not loading', () => {
		messageHandler({ type: 'result', content: 'done', isEdit: false, actions: [] });
		expect(() => {
			messageHandler({ type: 'thinkingStep', step: 'search_notes', label: 'Searching...' });
		}).not.toThrow();
	});

	it('shows default loading text initially before any thinkingStep arrives', () => {
		const loadingEl = document.getElementById('loadingIndicator');
		expect(loadingEl).not.toBeNull();
		expect(loadingEl!.textContent).toBeTruthy();
	});
});

describe('bottom bar layout', () => {
	beforeEach(() => {
		buildDOM();
		const mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	it('renders a .bottom-bar element inside .input-area', () => {
		const inputArea = document.querySelector('.input-area');
		const bottomBar = inputArea?.querySelector('.bottom-bar');
		expect(bottomBar).not.toBeNull();
	});

	it('renders .bottom-bar-left and .bottom-bar-right inside .bottom-bar', () => {
		const bottomBar = document.querySelector('.bottom-bar');
		expect(bottomBar?.querySelector('.bottom-bar-left')).not.toBeNull();
		expect(bottomBar?.querySelector('.bottom-bar-right')).not.toBeNull();
	});

	it('places modeSelect inside .bottom-bar', () => {
		const bottomBar = document.querySelector('.bottom-bar');
		const modeSelect = bottomBar?.querySelector('#modeSelect');
		expect(modeSelect).not.toBeNull();
	});

	it('modeSelect is NOT inside the .header', () => {
		const header = document.querySelector('.header');
		const modeSelectInHeader = header?.querySelector('#modeSelect');
		expect(modeSelectInHeader).toBeNull();
	});

	it('places #executeBtn inside .bottom-bar-right with send-btn class', () => {
		const bottomBarRight = document.querySelector('.bottom-bar-right');
		const sendBtn = bottomBarRight?.querySelector('#executeBtn');
		expect(sendBtn).not.toBeNull();
		expect(sendBtn?.classList.contains('send-btn')).toBe(true);
	});

	it('places #attachFileBtn inside .bottom-bar-left', () => {
		const bottomBarLeft = document.querySelector('.bottom-bar-left');
		const attachBtn = bottomBarLeft?.querySelector('#attachFileBtn');
		expect(attachBtn).not.toBeNull();
	});

	it('places #clearBtn inside .bottom-bar-left', () => {
		const bottomBarLeft = document.querySelector('.bottom-bar-left');
		const clearBtn = bottomBarLeft?.querySelector('#clearBtn');
		expect(clearBtn).not.toBeNull();
	});

	it('places #contextSizeContainer inside .bottom-bar-right', () => {
		const bottomBarRight = document.querySelector('.bottom-bar-right');
		const ctx = bottomBarRight?.querySelector('#contextSizeContainer');
		expect(ctx).not.toBeNull();
	});

	it('places #clearHistoryBtn inside .bottom-bar-right', () => {
		const bottomBarRight = document.querySelector('.bottom-bar-right');
		const clearHistoryBtn = bottomBarRight?.querySelector('#clearHistoryBtn');
		expect(clearHistoryBtn).not.toBeNull();
	});

	it('places #fileChips inside .input-container above the textarea', () => {
		const container = document.querySelector('.input-container');
		expect(container).not.toBeNull();
		const fileChips = container?.querySelector('#fileChips');
		expect(fileChips).not.toBeNull();
	});
});

describe('file chip CSS padding', () => {
	const cssSource = fs.readFileSync(path.resolve(__dirname, '..', 'panel.css'), 'utf-8');

	it('.file-chips container has non-zero padding so chips are not flush with container edges', () => {
		const match = cssSource.match(/\.file-chips\s*\{([^}]+)\}/);
		expect(match).not.toBeNull();
		const ruleBody = match![1];
		const paddingMatch = ruleBody.match(/padding:\s*([^;]+);/);
		expect(paddingMatch).not.toBeNull();
		const paddingValue = paddingMatch![1].trim();
		expect(paddingValue).not.toBe('0');
	});

	it('.file-chip has vertical padding of at least 4px', () => {
		const match = cssSource.match(/\.file-chip\s*\{[^}]*padding:\s*([^;]+);/);
		expect(match).not.toBeNull();
		const paddingValue = match![1].trim();
		const parts = paddingValue.split(/\s+/);
		const topPx = parseInt(parts[0], 10);
		expect(topPx).toBeGreaterThanOrEqual(4);
	});

	it('.file-chip has horizontal padding of at least 10px', () => {
		const match = cssSource.match(/\.file-chip\s*\{[^}]*padding:\s*([^;]+);/);
		expect(match).not.toBeNull();
		const paddingValue = match![1].trim();
		const parts = paddingValue.split(/\s+/);
		// shorthand: top right bottom left — or top+bottom / right+left
		const rightPx = parts.length >= 2 ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
		expect(rightPx).toBeGreaterThanOrEqual(10);
	});
});

describe('settings panel gear icon', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('renders a settings gear button in the header', () => {
		const btn = document.getElementById('settingsBtn');
		expect(btn).not.toBeNull();
	});

	it('sends getSettings message when gear button is clicked', () => {
		const btn = document.getElementById('settingsBtn') as HTMLButtonElement;
		btn.click();
		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'getSettings' }),
		);
	});

	it('shows settings overlay when settingsData is received after gear click', () => {
		const btn = document.getElementById('settingsBtn') as HTMLButtonElement;
		btn.click();

		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'settingsData',
			provider: 'openai',
			openaiModel: 'gpt-4o',
			claudeModel: 'claude-sonnet-4-20250514',
			perplexityModel: 'sonar',
			webSearchEnabled: false,
			webSearchModel: 'openai:gpt-4o-search-preview',
			imageGenModel: 'gpt-image/1.5-text-to-image',
			fileMaxSizeMb: 10,
			openaiKeySet: true,
			claudeKeySet: false,
			perplexityKeySet: false,
			kieKeySet: false,
			providerOptions: { openai: 'OpenAI', claude: 'Claude (Anthropic)', perplexity: 'Perplexity' },
			openaiModelOptions: { 'gpt-4o': 'GPT-4o' },
			claudeModelOptions: { 'claude-sonnet-4-20250514': 'Claude Sonnet 4' },
			perplexityModelOptions: { sonar: 'Sonar' },
			webSearchModelOptions: { 'openai:gpt-4o-search-preview': 'GPT-4o Search Preview' },
			imageGenModelOptions: { 'gpt-image/1.5-text-to-image': 'GPT Image 1.5' },
		});

		const settingsView = document.getElementById('settingsManageView') as HTMLElement;
		expect(settingsView.style.display).not.toBe('none');
	});

	it('renders provider select in the settings overlay with current value', () => {
		const btn = document.getElementById('settingsBtn') as HTMLButtonElement;
		btn.click();

		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'settingsData',
			provider: 'claude',
			openaiModel: 'gpt-4o',
			claudeModel: 'claude-sonnet-4-20250514',
			perplexityModel: 'sonar',
			webSearchEnabled: false,
			webSearchModel: 'openai:gpt-4o-search-preview',
			imageGenModel: 'gpt-image/1.5-text-to-image',
			fileMaxSizeMb: 10,
			openaiKeySet: false,
			claudeKeySet: true,
			perplexityKeySet: false,
			kieKeySet: false,
			providerOptions: { openai: 'OpenAI', claude: 'Claude (Anthropic)', perplexity: 'Perplexity' },
			openaiModelOptions: { 'gpt-4o': 'GPT-4o' },
			claudeModelOptions: { 'claude-sonnet-4-20250514': 'Claude Sonnet 4' },
			perplexityModelOptions: { sonar: 'Sonar' },
			webSearchModelOptions: { 'openai:gpt-4o-search-preview': 'GPT-4o Search Preview' },
			imageGenModelOptions: { 'gpt-image/1.5-text-to-image': 'GPT Image 1.5' },
		});

		const providerSelect = document.getElementById('settingsProvider') as HTMLSelectElement;
		expect(providerSelect).not.toBeNull();
		expect(providerSelect.value).toBe('claude');
	});

	it('renders claudecode provider and its dedicated fields in settings overlay', () => {
		const btn = document.getElementById('settingsBtn') as HTMLButtonElement;
		btn.click();

		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'settingsData',
			provider: 'claudecode',
			openaiModel: 'gpt-4o',
			claudeModel: 'claude-sonnet-4-20250514',
			claudeCodeModel: 'claude-sonnet-4-20250514',
			perplexityModel: 'sonar',
			webSearchEnabled: false,
			webSearchModel: 'openai:gpt-4o-search-preview',
			imageGenModel: 'gpt-image/1.5-text-to-image',
			fileMaxSizeMb: 10,
			openaiKeySet: false,
			claudeKeySet: false,
			claudeCodeKeySet: true,
			perplexityKeySet: false,
			kieKeySet: false,
			providerOptions: {
				openai: 'OpenAI',
				claude: 'Claude (Anthropic)',
				claudecode: 'Claude Code',
				perplexity: 'Perplexity',
			},
			openaiModelOptions: { 'gpt-4o': 'GPT-4o' },
			claudeModelOptions: { 'claude-sonnet-4-20250514': 'Claude Sonnet 4' },
			claudeCodeModelOptions: { 'claude-sonnet-4-20250514': 'Claude Sonnet 4' },
			perplexityModelOptions: { sonar: 'Sonar' },
			webSearchModelOptions: { 'openai:gpt-4o-search-preview': 'GPT-4o Search Preview' },
			imageGenModelOptions: { 'gpt-image/1.5-text-to-image': 'GPT Image 1.5' },
		});

		const providerSelect = document.getElementById('settingsProvider') as HTMLSelectElement;
		const claudeCodeKeyInput = document.getElementById('settingsClaudeCodeKey') as HTMLInputElement;
		expect(providerSelect.value).toBe('claudecode');
		expect(claudeCodeKeyInput).not.toBeNull();
		expect(claudeCodeKeyInput.placeholder).toContain('configured');
	});

	it('hides settings overlay when close button is clicked', () => {
		const btn = document.getElementById('settingsBtn') as HTMLButtonElement;
		btn.click();

		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'settingsData',
			provider: 'openai',
			openaiModel: 'gpt-4o',
			claudeModel: 'claude-sonnet-4-20250514',
			perplexityModel: 'sonar',
			webSearchEnabled: false,
			webSearchModel: 'openai:gpt-4o-search-preview',
			imageGenModel: 'gpt-image/1.5-text-to-image',
			fileMaxSizeMb: 10,
			openaiKeySet: false,
			claudeKeySet: false,
			perplexityKeySet: false,
			kieKeySet: false,
			providerOptions: { openai: 'OpenAI', claude: 'Claude' },
			openaiModelOptions: { 'gpt-4o': 'GPT-4o' },
			claudeModelOptions: {},
			perplexityModelOptions: {},
			webSearchModelOptions: {},
			imageGenModelOptions: {},
		});

		const closeBtn = document.getElementById('closeSettingsView') as HTMLButtonElement;
		expect(closeBtn).not.toBeNull();
		closeBtn.click();

		const settingsView = document.getElementById('settingsManageView') as HTMLElement;
		expect(settingsView.style.display).toBe('none');
	});

	it('sends saveSettings message when save button is clicked', () => {
		const btn = document.getElementById('settingsBtn') as HTMLButtonElement;
		btn.click();

		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'settingsData',
			provider: 'openai',
			openaiModel: 'gpt-4o',
			claudeModel: 'claude-sonnet-4-20250514',
			perplexityModel: 'sonar',
			webSearchEnabled: false,
			webSearchModel: 'openai:gpt-4o-search-preview',
			imageGenModel: 'gpt-image/1.5-text-to-image',
			fileMaxSizeMb: 10,
			openaiKeySet: false,
			claudeKeySet: false,
			perplexityKeySet: false,
			kieKeySet: false,
			providerOptions: { openai: 'OpenAI', claude: 'Claude' },
			openaiModelOptions: { 'gpt-4o': 'GPT-4o' },
			claudeModelOptions: {},
			perplexityModelOptions: {},
			webSearchModelOptions: {},
			imageGenModelOptions: {},
		});

		const saveBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
		expect(saveBtn).not.toBeNull();
		saveBtn.click();

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'saveSettings' }),
		);
	});

	it('hides settings overlay after save button is clicked', () => {
		const btn = document.getElementById('settingsBtn') as HTMLButtonElement;
		btn.click();

		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'settingsData',
			provider: 'openai',
			openaiModel: 'gpt-4o',
			claudeModel: 'claude-sonnet-4-20250514',
			perplexityModel: 'sonar',
			webSearchEnabled: false,
			webSearchModel: 'openai:gpt-4o-search-preview',
			imageGenModel: 'gpt-image/1.5-text-to-image',
			fileMaxSizeMb: 10,
			openaiKeySet: false,
			claudeKeySet: false,
			perplexityKeySet: false,
			kieKeySet: false,
			providerOptions: { openai: 'OpenAI', claude: 'Claude' },
			openaiModelOptions: { 'gpt-4o': 'GPT-4o' },
			claudeModelOptions: {},
			perplexityModelOptions: {},
			webSearchModelOptions: {},
			imageGenModelOptions: {},
		});

		const settingsView = document.getElementById('settingsManageView') as HTMLElement;
		expect(settingsView.style.display).not.toBe('none');

		const saveBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement;
		saveBtn.click();

		expect(settingsView.style.display).toBe('none');
	});

	it('shows API key status indicator when key is configured', () => {
		const btn = document.getElementById('settingsBtn') as HTMLButtonElement;
		btn.click();

		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'settingsData',
			provider: 'openai',
			openaiModel: 'gpt-4o',
			claudeModel: 'claude-sonnet-4-20250514',
			perplexityModel: 'sonar',
			webSearchEnabled: false,
			webSearchModel: 'openai:gpt-4o-search-preview',
			imageGenModel: 'gpt-image/1.5-text-to-image',
			fileMaxSizeMb: 10,
			openaiKeySet: true,
			claudeKeySet: false,
			perplexityKeySet: false,
			kieKeySet: false,
			providerOptions: { openai: 'OpenAI' },
			openaiModelOptions: { 'gpt-4o': 'GPT-4o' },
			claudeModelOptions: {},
			perplexityModelOptions: {},
			webSearchModelOptions: {},
			imageGenModelOptions: {},
		});

		const openaiKeyInput = document.getElementById('settingsOpenaiKey') as HTMLInputElement;
		expect(openaiKeyInput).not.toBeNull();
		expect(openaiKeyInput.placeholder).toContain('configured');
	});
});

describe('SVG icon replacement — HTML template', () => {
	let container: HTMLDivElement;

	beforeEach(() => {
		const panelTsSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'panel.ts'), 'utf-8');
		const htmlMatch = panelTsSource.match(/const CHAT_PANEL_HTML = `([\s\S]*?)`;/);
		expect(htmlMatch).not.toBeNull();
		container = document.createElement('div');
		container.innerHTML = htmlMatch![1];
	});

	it('should render the header robot icon as SVG', () => {
		const headerIcon = container.querySelector('.header-title .icon');
		expect(headerIcon).not.toBeNull();
		expect(headerIcon!.querySelector('svg')).not.toBeNull();
	});

	it('should render the settings gear button as SVG', () => {
		const settingsBtn = container.querySelector('#settingsBtn');
		expect(settingsBtn).not.toBeNull();
		expect(settingsBtn!.querySelector('svg')).not.toBeNull();
	});

	it('should render the empty state icon as SVG', () => {
		const emptyIcon = container.querySelector('.empty-state .icon');
		expect(emptyIcon).not.toBeNull();
		expect(emptyIcon!.querySelector('svg')).not.toBeNull();
	});

	it('should render the attach file button as SVG', () => {
		const attachBtn = container.querySelector('#attachFileBtn');
		expect(attachBtn).not.toBeNull();
		expect(attachBtn!.querySelector('svg')).not.toBeNull();
	});

	it('should render the clear input button as SVG', () => {
		const clearBtn = container.querySelector('#clearBtn');
		expect(clearBtn).not.toBeNull();
		expect(clearBtn!.querySelector('svg')).not.toBeNull();
	});

	it('should render the clear history button as SVG', () => {
		const historyBtn = container.querySelector('#clearHistoryBtn');
		expect(historyBtn).not.toBeNull();
		expect(historyBtn!.querySelector('svg')).not.toBeNull();
	});

	it('should render the send button as SVG', () => {
		const sendBtn = container.querySelector('#executeBtn');
		expect(sendBtn).not.toBeNull();
		expect(sendBtn!.querySelector('svg')).not.toBeNull();
	});

	it('should not contain emoji HTML entities in the template', () => {
		const panelTsSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'panel.ts'), 'utf-8');
		const htmlMatch = panelTsSource.match(/const CHAT_PANEL_HTML = `([\s\S]*?)`;/);
		const html = htmlMatch![1];
		const emojiEntities = [
			'&#x1F916;',
			'&#x1F4AC;',
			'&#x1F4CE;',
			'&#x1F9F9;',
			'&#x27A4;',
			'&#x2699;',
			'&#x270F;',
		];
		for (const entity of emojiEntities) {
			expect(html).not.toContain(entity);
		}
	});
});

describe('SVG icon replacement — dynamic content', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('should render success action labels with SVG instead of emoji', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'result',
			isEdit: false,
			content: 'Done',
			actions: [{ action: 'test_action', success: true, message: 'OK' }],
		});

		const actionMsg = document.querySelector('.message-action-success');
		expect(actionMsg).not.toBeNull();
		const label = actionMsg!.querySelector('.message-label') as HTMLElement;
		expect(label.querySelector('svg')).not.toBeNull();
		expect(label.textContent).not.toContain('\u2705');
	});

	it('should render error action labels with SVG instead of emoji', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'result',
			isEdit: false,
			content: 'Oops',
			actions: [{ action: 'fail_action', success: false, message: 'Fail' }],
		});

		const actionMsg = document.querySelector('.message-action-error');
		expect(actionMsg).not.toBeNull();
		const label = actionMsg!.querySelector('.message-label') as HTMLElement;
		expect(label.querySelector('svg')).not.toBeNull();
		expect(label.textContent).not.toContain('\u274C');
	});

	it('should render note info with SVG document icon instead of emoji', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({ type: 'noteInfo', title: 'Test Note' });

		const noteInfo = document.getElementById('noteInfo') as HTMLElement;
		expect(noteInfo.querySelector('svg')).not.toBeNull();
		expect(noteInfo.textContent).not.toContain('\uD83D\uDCC4');
	});

	it('should render file attachment chips with SVG paperclip instead of emoji', (done) => {
		const fileInput = document.getElementById('fileInput') as HTMLInputElement;
		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		const file = new File(['data'], 'test.csv', { type: 'text/csv' });
		Object.defineProperty(fileInput, 'files', {
			value: [file],
			writable: true,
			configurable: true,
		});
		fileInput.dispatchEvent(new Event('change'));

		setTimeout(() => {
			promptInput.value = 'Check file';
			pressKey(promptInput, 'Enter');
			const chip = document.querySelector('.message-attachment-chip') as HTMLElement;
			expect(chip).not.toBeNull();
			expect(chip.querySelector('svg')).not.toBeNull();
			expect(chip.textContent).not.toContain('\uD83D\uDCCE');
			done();
		}, 100);
	});

	it('should render edit confirmation with SVG check instead of emoji', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'result',
			isEdit: true,
			content: '',
			actions: [],
		});

		const editMsg = document.querySelector('.message-edit');
		expect(editMsg).not.toBeNull();
		const label = editMsg!.querySelector('.message-label') as HTMLElement;
		expect(label.querySelector('svg')).not.toBeNull();
		expect(label.textContent).not.toContain('\u2705');
	});

	it('should render web search action with SVG globe instead of emoji', () => {
		const messageHandler = mockApi.onMessage.mock.calls[0][0] as (msg: any) => void;
		messageHandler({
			type: 'result',
			isEdit: false,
			content: 'Search result',
			actions: [
				{
					action: 'web_search',
					success: true,
					message: 'Found info',
					data: { searchProvider: 'google', searchModel: 'test' },
				},
			],
		});

		const searchMsg = document.querySelector('.message-action-search');
		expect(searchMsg).not.toBeNull();
		const label = searchMsg!.querySelector('.message-label') as HTMLElement;
		expect(label.querySelector('svg')).not.toBeNull();
		expect(label.textContent).not.toContain('\uD83C\uDF10');
	});

	it('should render close buttons in manage view with SVG instead of emoji', () => {
		const manageBtn = document.querySelector('#manageRolesBtn') as HTMLButtonElement;
		manageBtn.click();
		const closeBtn = document.getElementById('closeManageView') as HTMLElement;
		expect(closeBtn).not.toBeNull();
		expect(closeBtn.querySelector('svg')).not.toBeNull();
	});

	it('should render queue item action buttons with SVGs instead of emojis', () => {
		const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
		promptInput.value = 'First message';
		pressKey(promptInput, 'Enter');

		promptInput.value = 'Queued message';
		pressKey(promptInput, 'Enter');

		const editBtn = document.querySelector('.queue-item-edit') as HTMLElement;
		const deleteBtn = document.querySelector('.queue-item-delete') as HTMLElement;
		const forceBtn = document.querySelector('.queue-item-force') as HTMLElement;
		expect(editBtn).not.toBeNull();
		expect(deleteBtn).not.toBeNull();
		expect(forceBtn).not.toBeNull();
		expect(editBtn.querySelector('svg')).not.toBeNull();
		expect(deleteBtn.querySelector('svg')).not.toBeNull();
		expect(forceBtn.querySelector('svg')).not.toBeNull();
	});
});

describe('thinking timer in loading indicator', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let messageHandler: (msg: unknown) => void;

	beforeEach(() => {
		jest.useFakeTimers();
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		messageHandler = mockApi.onMessage.mock.calls[0][0];
	});

	afterEach(() => {
		jest.useRealTimers();
		delete (window as any).webviewApi;
	});

	it('shows a timer element with initial value 0:00 when loading starts', () => {
		messageHandler({ type: 'loading', status: true });

		const loadingEl = document.getElementById('loadingIndicator');
		expect(loadingEl).not.toBeNull();
		const timerEl = loadingEl!.querySelector('.loading-timer');
		expect(timerEl).not.toBeNull();
		expect(timerEl!.textContent).toBe('0:00');
	});

	it('increments the timer every second', () => {
		messageHandler({ type: 'loading', status: true });

		jest.advanceTimersByTime(3000);

		const loadingEl = document.getElementById('loadingIndicator');
		const timerEl = loadingEl!.querySelector('.loading-timer');
		expect(timerEl!.textContent).toBe('0:03');
	});

	it('formats time as M:SS when over 60 seconds', () => {
		messageHandler({ type: 'loading', status: true });

		jest.advanceTimersByTime(75000);

		const loadingEl = document.getElementById('loadingIndicator');
		const timerEl = loadingEl!.querySelector('.loading-timer');
		expect(timerEl!.textContent).toBe('1:15');
	});

	it('removes the timer element when loading stops', () => {
		messageHandler({ type: 'loading', status: true });
		jest.advanceTimersByTime(2000);

		messageHandler({ type: 'loading', status: false });

		expect(document.getElementById('loadingIndicator')).toBeNull();
	});

	it('resets the timer to 0:00 when loading restarts', () => {
		messageHandler({ type: 'loading', status: true });
		jest.advanceTimersByTime(5000);

		messageHandler({ type: 'loading', status: false });
		messageHandler({ type: 'loading', status: true });

		const loadingEl = document.getElementById('loadingIndicator');
		const timerEl = loadingEl!.querySelector('.loading-timer');
		expect(timerEl!.textContent).toBe('0:00');
	});
});
