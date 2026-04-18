import { SETTING_KEYS } from '../settings';

const MOCK_CHAT_HANDLE = 'chat-panel-handle';
const MOCK_EDITOR_HANDLE = 'editor-panel-handle';

const mockPostMessage = jest.fn();
let createCallCount = 0;
const mockCreate = jest.fn().mockImplementation(() => {
	createCallCount++;
	return createCallCount === 1
		? Promise.resolve(MOCK_CHAT_HANDLE)
		: Promise.resolve(MOCK_EDITOR_HANDLE);
});
const mockShow = jest.fn().mockResolvedValue(undefined);
const mockHide = jest.fn().mockResolvedValue(undefined);
const mockSettingsValues = jest.fn();
const mockSettingsValue = jest.fn();
const mockSelectedNote = jest.fn();
const mockDataGet = jest.fn();
const mockOnNoteSelectionChange = jest.fn().mockResolvedValue(undefined);

const capturedOnMessageCallbacks: Record<string, (message: any) => Promise<void>> = {};

jest.mock('../utils/share-note', () => ({
	exportNoteAsRtf: jest.fn().mockResolvedValue(undefined),
	exportNoteAsDocx: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('api', () => ({
	__esModule: true,
	default: {
		views: {
			panels: {
				create: (...args: any[]) => mockCreate(...args),
				setHtml: jest.fn().mockResolvedValue(undefined),
				addScript: jest.fn().mockResolvedValue(undefined),
				hide: (...args: any[]) => mockHide(...args),
				show: (...args: any[]) => mockShow(...args),
				onMessage: jest
					.fn()
					.mockImplementation((handle: string, cb: (...args: unknown[]) => void) => {
						capturedOnMessageCallbacks[handle] = cb as (message: any) => Promise<void>;
						return Promise.resolve();
					}),
				postMessage: (...args: any[]) => mockPostMessage(...args),
			},
		},
		settings: {
			values: (...args: any[]) => mockSettingsValues(...args),
			value: (...args: any[]) => mockSettingsValue(...args),
			setValue: jest.fn().mockResolvedValue(undefined),
		},
		workspace: {
			selectedNote: (...args: any[]) => mockSelectedNote(...args),
			onNoteSelectionChange: (...args: any[]) => mockOnNoteSelectionChange(...args),
		},
		data: {
			get: (...args: any[]) => mockDataGet(...args),
			put: jest.fn().mockResolvedValue(undefined),
		},
		commands: {
			execute: jest.fn().mockResolvedValue(undefined),
		},
	},
}));

jest.mock('../ai/service', () => ({
	sendToAI: jest.fn(),
	buildSystemPrompt: jest.fn(() => 'mocked system prompt'),
}));

jest.mock('../utils/pdf-extract', () => ({
	extractPdfTextFromBase64: jest.fn(),
}));

import { initPanel, togglePanel, toggleBlockEditorPane } from '../panel';

describe('panel separation — two independent panels', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		createCallCount = 0;
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE).mockResolvedValueOnce(MOCK_EDITOR_HANDLE);
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Note body.',
		});
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		await initPanel();
	});

	it('creates two separate panels during init', () => {
		expect(mockCreate).toHaveBeenCalledTimes(2);
	});

	it('creates chat panel first (far-right position)', () => {
		expect(mockCreate.mock.calls[0][0]).toBe('aiChatPanel');
	});

	it('creates block editor panel second (closer to editor)', () => {
		expect(mockCreate.mock.calls[1][0]).toBe('blockEditorPanel');
	});

	it('creates a chat panel with a distinct ID', () => {
		expect(mockCreate).toHaveBeenCalledWith('aiChatPanel');
	});

	it('creates an editor panel with a distinct ID', () => {
		expect(mockCreate).toHaveBeenCalledWith('blockEditorPanel');
	});

	it('hides both panels on init', () => {
		expect(mockHide).toHaveBeenCalledWith(MOCK_CHAT_HANDLE);
		expect(mockHide).toHaveBeenCalledWith(MOCK_EDITOR_HANDLE);
	});

	it('registers separate onMessage handlers for each panel', () => {
		expect(capturedOnMessageCallbacks[MOCK_CHAT_HANDLE]).toBeDefined();
		expect(capturedOnMessageCallbacks[MOCK_EDITOR_HANDLE]).toBeDefined();
	});
});

describe('togglePanel — chat panel only', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		createCallCount = 0;
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE).mockResolvedValueOnce(MOCK_EDITOR_HANDLE);
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Note body.',
		});
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		await initPanel();
		jest.clearAllMocks();
	});

	it('shows only the chat panel when toggled on', async () => {
		await togglePanel();
		expect(mockShow).toHaveBeenCalledWith(MOCK_CHAT_HANDLE);
		expect(mockShow).not.toHaveBeenCalledWith(MOCK_EDITOR_HANDLE);
	});

	it('hides only the chat panel when toggled off', async () => {
		await togglePanel();
		jest.clearAllMocks();
		await togglePanel();
		expect(mockHide).toHaveBeenCalledWith(MOCK_CHAT_HANDLE);
		expect(mockHide).not.toHaveBeenCalledWith(MOCK_EDITOR_HANDLE);
	});

	it('does NOT send blockEditorState message when toggling chat', async () => {
		await togglePanel();
		const postCalls = mockPostMessage.mock.calls;
		const types = postCalls.map((c: any[]) => c[1]?.type);
		expect(types).not.toContain('blockEditorState');
	});

	it('does NOT send showAiChat message when toggling chat', async () => {
		await togglePanel();
		const postCalls = mockPostMessage.mock.calls;
		const types = postCalls.map((c: any[]) => c[1]?.type);
		expect(types).not.toContain('showAiChat');
	});
});

describe('toggleBlockEditorPane — editor panel only', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		createCallCount = 0;
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE).mockResolvedValueOnce(MOCK_EDITOR_HANDLE);
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Note body.',
		});
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		await initPanel();
		jest.clearAllMocks();
	});

	it('shows only the editor panel when toggled on', async () => {
		await toggleBlockEditorPane();
		expect(mockShow).toHaveBeenCalledWith(MOCK_EDITOR_HANDLE);
		expect(mockShow).not.toHaveBeenCalledWith(MOCK_CHAT_HANDLE);
	});

	it('hides only the editor panel when toggled off', async () => {
		await toggleBlockEditorPane();
		jest.clearAllMocks();
		await toggleBlockEditorPane();
		expect(mockHide).toHaveBeenCalledWith(MOCK_EDITOR_HANDLE);
		expect(mockHide).not.toHaveBeenCalledWith(MOCK_CHAT_HANDLE);
	});

	it('sends noteLoaded to the editor panel when toggled on', async () => {
		await toggleBlockEditorPane();
		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_EDITOR_HANDLE,
			expect.objectContaining({
				type: 'noteLoaded',
				note: expect.objectContaining({ id: 'note-1' }),
			}),
		);
	});

	it('does NOT send any message to chat panel when toggling editor', async () => {
		await toggleBlockEditorPane();
		const chatMessages = mockPostMessage.mock.calls.filter((c: any[]) => c[0] === MOCK_CHAT_HANDLE);
		expect(chatMessages).toHaveLength(0);
	});

	it('sends noteLoaded to editor panel when editor sends getNote message', async () => {
		jest.clearAllMocks();
		const editorCallback = capturedOnMessageCallbacks[MOCK_EDITOR_HANDLE];
		await editorCallback({ type: 'getNote' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_EDITOR_HANDLE,
			expect.objectContaining({
				type: 'noteLoaded',
				note: expect.objectContaining({ id: 'note-1' }),
			}),
		);
	});

	it('does NOT send noteLoaded to chat panel when editor sends getNote', async () => {
		jest.clearAllMocks();
		const editorCallback = capturedOnMessageCallbacks[MOCK_EDITOR_HANDLE];
		await editorCallback({ type: 'getNote' });

		const chatMessages = mockPostMessage.mock.calls.filter((c: any[]) => c[0] === MOCK_CHAT_HANDLE);
		expect(chatMessages).toHaveLength(0);
	});
});

describe('independent toggle — no cross-panel interference', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		createCallCount = 0;
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE).mockResolvedValueOnce(MOCK_EDITOR_HANDLE);
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Note body.',
		});
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		await initPanel();
		jest.clearAllMocks();
	});

	it('can open both panels simultaneously', async () => {
		await togglePanel();
		await toggleBlockEditorPane();
		expect(mockShow).toHaveBeenCalledWith(MOCK_CHAT_HANDLE);
		expect(mockShow).toHaveBeenCalledWith(MOCK_EDITOR_HANDLE);
	});

	it('closing chat does not close editor', async () => {
		await togglePanel();
		await toggleBlockEditorPane();
		jest.clearAllMocks();
		await togglePanel();
		expect(mockHide).toHaveBeenCalledWith(MOCK_CHAT_HANDLE);
		expect(mockHide).not.toHaveBeenCalledWith(MOCK_EDITOR_HANDLE);
	});

	it('closing editor does not close chat', async () => {
		await togglePanel();
		await toggleBlockEditorPane();
		jest.clearAllMocks();
		await toggleBlockEditorPane();
		expect(mockHide).toHaveBeenCalledWith(MOCK_EDITOR_HANDLE);
		expect(mockHide).not.toHaveBeenCalledWith(MOCK_CHAT_HANDLE);
	});
});
