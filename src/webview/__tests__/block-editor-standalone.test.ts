/**
 * @jest-environment jsdom
 *
 * Tests that block-editor.js works standalone in its own panel:
 * - Receives noteLoaded via webviewApi.onMessage (not cross-window events)
 * - Does NOT rely on ai:enableEditor / ai:disableEditor events
 * - Does NOT dispatch be:showAiChat or be:chatVisibilityRequest events
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'block-editor.js'),
	'utf-8',
);

const buildDOM = (): void => {
	document.body.innerHTML = `
		<div id="app">
			<div id="editor-container" tabindex="-1"></div>
			<div id="slash-menu"></div>
			<div id="vim-statusbar" data-mode="insert">
				<span id="vim-mode-label">INSERT</span>
			</div>
		</div>
	`;
};

const makeMockEditor = () => ({
	blocks: {
		getBlocksCount: jest.fn().mockReturnValue(1),
		getCurrentBlockIndex: jest.fn().mockReturnValue(0),
		delete: jest.fn(),
		insert: jest.fn(),
	},
	caret: { setToBlock: jest.fn() },
	isReady: Promise.resolve(),
	save: jest.fn().mockResolvedValue({ blocks: [] }),
	render: jest.fn().mockResolvedValue(undefined),
	clear: jest.fn().mockResolvedValue(undefined),
});

let capturedOnMessageHandler: ((event: { message: unknown }) => void) | null = null;

const registerGlobals = (): void => {
	const mockEditor = makeMockEditor();
	(window as any).EditorJS = jest.fn().mockImplementation(({ onReady }: any) => {
		onReady?.();
		return mockEditor;
	});
	(window as any).DragDrop = jest.fn();
	(window as any).Header = jest.fn();
	(window as any).EditorjsList = jest.fn();
	(window as any).Checklist = jest.fn();
	(window as any).CodeTool = jest.fn();
	(window as any).Quote = jest.fn();
	(window as any).Delimiter = jest.fn();
	(window as any).MarkdownConverter = {
		markdownToBlocks: jest.fn().mockReturnValue([]),
		blocksToMarkdown: jest.fn().mockReturnValue(''),
	};
	(window as any).webviewApi = {
		postMessage: jest.fn(),
		onMessage: jest.fn().mockImplementation((handler: (e: { message: unknown }) => void) => {
			capturedOnMessageHandler = handler;
		}),
	};
};

const cleanupGlobals = (): void => {
	for (const key of [
		'BlockEditor',
		'EditorJS',
		'DragDrop',
		'Header',
		'EditorjsList',
		'Checklist',
		'CodeTool',
		'Quote',
		'Delimiter',
		'MarkdownConverter',
		'webviewApi',
		'__lastNoteLoaded',
	]) {
		delete (window as any)[key];
	}
};

const sendMessage = (msg: unknown): void => {
	capturedOnMessageHandler?.({ message: msg });
};

beforeEach(() => {
	jest.clearAllMocks();
	jest.useFakeTimers();
	window.HTMLElement.prototype.scrollIntoView = jest.fn();
	capturedOnMessageHandler = null;
	localStorage.clear();
	buildDOM();
	registerGlobals();
	eval(blockEditorSource);
});

afterEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	cleanupGlobals();
	jest.useRealTimers();
});

describe('block-editor.js standalone message handling', () => {
	it('registers an onMessage handler via webviewApi', () => {
		expect((window as any).webviewApi.onMessage).toHaveBeenCalledTimes(1);
	});

	it('loads note when noteLoaded message is received via webviewApi', () => {
		const note = { id: 'note-1', title: 'Test', body: '# Hello' };
		sendMessage({ type: 'noteLoaded', note });
		expect((window as any).BlockEditor.getNoteId()).toBe('note-1');
	});

	it('clears editor when noteLoaded with null note is received', () => {
		sendMessage({ type: 'noteLoaded', note: null });
		expect((window as any).BlockEditor.getNoteId()).toBeNull();
	});
});

describe('block-editor.js does NOT rely on cross-panel events', () => {
	it('does NOT listen for ai:enableEditor and change visibility', () => {
		const app = document.getElementById('app');
		window.dispatchEvent(new CustomEvent('ai:enableEditor', { detail: { editorOnly: true } }));
		expect(app?.classList.contains('editor-visible')).toBe(false);
		expect(app?.classList.contains('editor-only')).toBe(false);
	});

	it('does NOT dispatch be:showAiChat event during boot', () => {
		const spy = jest.fn();
		window.addEventListener('be:showAiChat', spy);
		cleanupGlobals();
		buildDOM();
		registerGlobals();
		eval(blockEditorSource);
		window.removeEventListener('be:showAiChat', spy);
		expect(spy).not.toHaveBeenCalled();
	});

	it('does NOT dispatch be:chatVisibilityRequest when note loads', () => {
		const spy = jest.fn();
		window.addEventListener('be:chatVisibilityRequest', spy);
		sendMessage({ type: 'noteLoaded', note: { id: '1', title: 'T', body: '# B' } });
		window.removeEventListener('be:chatVisibilityRequest', spy);
		expect(spy).not.toHaveBeenCalled();
	});

	it('does NOT use localStorage for editor visibility', () => {
		sendMessage({ type: 'noteLoaded', note: { id: '1', title: 'T', body: '# B' } });
		expect(localStorage.getItem('joplin-ai-editor-visible')).toBeNull();
		expect(localStorage.getItem('joplin-ai-editor-only')).toBeNull();
	});
});

describe('block-editor.js requests initial note on boot', () => {
	it('sends getNote message via webviewApi.postMessage during boot', () => {
		expect((window as any).webviewApi.postMessage).toHaveBeenCalledWith({
			type: 'getNote',
		});
	});
});
