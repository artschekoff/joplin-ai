/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

const panelJsSource = fs.readFileSync(path.resolve(__dirname, '..', 'panel.js'), 'utf-8');

const buildDOM = (): void => {
	document.body.innerHTML = `
		<div id="app">
			<div class="messages" id="messages">
				<div class="empty-state" id="emptyState"></div>
			</div>
			<textarea id="promptInput"></textarea>
			<button id="executeBtn"></button>
			<button id="clearBtn">&#x1F5D1; Clear</button>
			<div id="noteInfo"></div>
		</div>
	`;
};

const createMockWebviewApi = () => ({
	postMessage: jest.fn(),
	onMessage: jest.fn(),
});

const initPanel = (mockApi: ReturnType<typeof createMockWebviewApi>): void => {
	(window as any).webviewApi = mockApi;
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

	it('re-enables execute button after alert', () => {
		const executeBtn = document.getElementById('executeBtn') as HTMLButtonElement;
		const messageHandler = mockApi.onMessage.mock.calls[0][0];

		messageHandler({ type: 'loading', status: true });
		expect(executeBtn.disabled).toBe(true);

		messageHandler({ type: 'alert', message: 'Key missing' });
		expect(executeBtn.disabled).toBe(false);
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

describe('PANEL_HTML clear button icon', () => {
	it('should include an icon in the clear button', () => {
		const panelTsSource = fs.readFileSync(path.resolve(__dirname, '..', '..', 'panel.ts'), 'utf-8');

		const htmlMatch = panelTsSource.match(/const PANEL_HTML = `([\s\S]*?)`;/);
		expect(htmlMatch).not.toBeNull();

		const container = document.createElement('div');
		container.innerHTML = htmlMatch![1];
		const clearBtn = container.querySelector('#clearBtn');
		expect(clearBtn).not.toBeNull();

		const textContent = clearBtn!.textContent!.trim();
		expect(textContent).not.toBe('Clear');
		expect(textContent.length).toBeGreaterThan('Clear'.length);
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

	it('clears messages and restores empty state', () => {
		const messagesEl = document.getElementById('messages') as HTMLElement;
		const emptyState = document.getElementById('emptyState') as HTMLElement;

		const messageHandler = mockApi.onMessage.mock.calls[0][0];
		messageHandler({ type: 'result', content: 'AI response', isEdit: false });
		expect(emptyState.style.display).toBe('none');

		clearBtn.click();

		expect(messagesEl.querySelector('.message')).toBeNull();
		expect(emptyState.style.display).toBe('');
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
});
