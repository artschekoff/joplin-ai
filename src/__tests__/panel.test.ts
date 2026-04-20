import { SETTING_KEYS } from '../settings';

const MOCK_CHAT_HANDLE = 'chat-panel-handle';
const MOCK_EDITOR_HANDLE = 'editor-panel-handle';
const MOCK_PANEL_HANDLE = MOCK_CHAT_HANDLE;

const mockPostMessage = jest.fn();
const mockCreate = jest.fn();
const mockSettingsValues = jest.fn();
const mockSettingsValue = jest.fn();
const mockSettingsSetValue = jest.fn().mockResolvedValue(undefined);
const mockSelectedNote = jest.fn();
const mockDataGet = jest.fn();
const mockDataPut = jest.fn().mockResolvedValue(undefined);
const mockOnNoteSelectionChange = jest.fn().mockResolvedValue(undefined);

const capturedCallbacks: Record<string, (message: any) => Promise<void>> = {};
let capturedOnMessageCallback: (message: any) => Promise<void>;

const mockCommandsExecute = jest.fn().mockResolvedValue(undefined);
const mockShowOpenDialog = jest.fn().mockResolvedValue(['/Users/me/Documents']);
const mockShowToast = jest.fn().mockResolvedValue(undefined);

jest.mock('api', () => ({
	__esModule: true,
	default: {
		views: {
			panels: {
				create: (...args: any[]) => mockCreate(...args),
				setHtml: jest.fn().mockResolvedValue(undefined),
				addScript: jest.fn().mockResolvedValue(undefined),
				hide: jest.fn().mockResolvedValue(undefined),
				show: jest.fn().mockResolvedValue(undefined),
				onMessage: jest
					.fn()
					.mockImplementation((handle: string, cb: (...args: unknown[]) => void) => {
						capturedCallbacks[handle] = cb as (message: any) => Promise<void>;
						if (handle === MOCK_CHAT_HANDLE) {
							capturedOnMessageCallback = cb as (message: any) => Promise<void>;
						}
						return Promise.resolve();
					}),
				postMessage: (...args: any[]) => mockPostMessage(...args),
			},
			dialogs: {
				showOpenDialog: (...args: any[]) => mockShowOpenDialog(...args),
				showMessageBox: jest.fn().mockResolvedValue(0),
				showToast: (...args: any[]) => mockShowToast(...args),
			},
		},
		settings: {
			values: (...args: any[]) => mockSettingsValues(...args),
			value: (...args: any[]) => mockSettingsValue(...args),
			setValue: (...args: any[]) => mockSettingsSetValue(...args),
		},
		workspace: {
			selectedNote: (...args: any[]) => mockSelectedNote(...args),
			onNoteSelectionChange: (...args: any[]) => mockOnNoteSelectionChange(...args),
		},
		data: {
			get: (...args: any[]) => mockDataGet(...args),
			put: (...args: any[]) => mockDataPut(...args),
		},
		commands: {
			execute: (...args: any[]) => mockCommandsExecute(...args),
		},
	},
}));

jest.mock('../ai/service', () => ({
	sendToAI: jest.fn(),
	buildSystemPrompt: jest.fn(() => 'mocked system prompt with some content to estimate tokens'),
	buildSystemPromptParts: jest.fn(() => ({
		staticInstructions: 'mocked static instructions with some content to estimate tokens',
		noteBodyContext: '\nCurrent note title: Test\nCurrent note content:\nmocked body',
		dynamicContext: '',
	})),
}));

const mockExtractPdf = jest.fn();
jest.mock('../utils/pdf-extract', () => ({
	extractPdfTextFromBase64: (...args: unknown[]) => mockExtractPdf(...args),
}));

import { initPanel, setEditorSelection, togglePanel, triggerAskAI } from '../panel';
import { sendToAI } from '../ai/service';

const mockedSendToAI = sendToAI as jest.MockedFunction<typeof sendToAI>;

describe('panel creation order', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE);
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test-key',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Some existing content.',
		});
		await initPanel();
	});

	it('creates the AI chat panel', () => {
		const createCalls = mockCreate.mock.calls.map((call: unknown[]) => call[0]);
		expect(createCalls[0]).toBe('aiChatPanel');
	});
});

describe('panel handleExecute', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE);
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test-key',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Some existing content.',
		});

		await initPanel();
	});

	it('sends result with actions when AI uses tools', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'I updated the note.',
			isEdit: true,
			editedBody: undefined,
			actions: [
				{
					action: 'update_note',
					success: true,
					message: 'Note "Test Note" body updated',
				},
			],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'rewrite the note' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'result',
				isEdit: true,
				actions: [expect.objectContaining({ action: 'update_note', success: true })],
			}),
		);
	});

	it('passes action context with current note ID to sendToAI', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'hello' });

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'hello',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({ currentNoteId: 'note-1', currentNoteTitle: 'Test Note' }),
			undefined,
			undefined,
			undefined,
		);
	});

	it('sends result without edit when AI answers a question', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'This note is about testing.',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'what is this about?' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'result',
				isEdit: false,
				content: 'This note is about testing.',
				actions: [],
			}),
		);
	});

	it('refreshes note info after edit', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'Updated.',
			isEdit: true,
			editedBody: undefined,
			actions: [{ action: 'update_note', success: true, message: 'updated' }],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'rewrite' });

		const postMessageCalls = mockPostMessage.mock.calls;
		const types = postMessageCalls.map((call: unknown[]) => (call[1] as { type: string }).type);
		expect(types).toContain('noteInfo');
	});

	it('shows error when no note is selected', async () => {
		mockSelectedNote.mockResolvedValue(null);
		mockDataGet.mockResolvedValue(null);

		await capturedOnMessageCallback({ type: 'execute', prompt: 'test' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'error',
				message: expect.stringContaining('No note'),
			}),
		);
	});

	it('shows alert when API key is missing', async () => {
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: '',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'test' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'alert',
				message: expect.stringContaining('API key'),
			}),
		);
	});

	it('passes conversation history from message to sendToAI', async () => {
		const mockHistory = [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi!' },
		];

		mockedSendToAI.mockResolvedValue({
			content: 'I remember.',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'What did I say?',
			history: mockHistory,
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'What did I say?',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({ currentNoteId: 'note-1', currentNoteTitle: 'Test Note' }),
			mockHistory,
			undefined,
			undefined,
		);
	});

	it('passes undefined history when message has no history field', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'hello' });

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'hello',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({ currentNoteId: 'note-1', currentNoteTitle: 'Test Note' }),
			undefined,
			undefined,
			undefined,
		);
	});

	it('fetches notebooks and passes them in action context', async () => {
		mockDataGet.mockImplementation((args: string[]) => {
			if (Array.isArray(args) && args[0] === 'folders') {
				return Promise.resolve({
					items: [
						{ id: 'f1', title: 'Work', parent_id: '' },
						{ id: 'f2', title: 'Personal', parent_id: '' },
					],
				});
			}
			return Promise.resolve({ id: 'note-1', title: 'Test Note', body: 'Some existing content.' });
		});

		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'create a work note' });

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'create a work note',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({
				currentNoteId: 'note-1',
				currentNoteTitle: 'Test Note',
				notebooks: [
					{ id: 'f1', title: 'Work' },
					{ id: 'f2', title: 'Personal' },
				],
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('passes empty notebooks array when no notebooks exist', async () => {
		mockDataGet.mockImplementation((args: string[]) => {
			if (Array.isArray(args) && args[0] === 'folders') {
				return Promise.resolve({ items: [] });
			}
			return Promise.resolve({ id: 'note-1', title: 'Test Note', body: 'Some existing content.' });
		});

		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'hello' });

		expect(mockedSendToAI).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			'hello',
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ notebooks: [] }),
			undefined,
			undefined,
			undefined,
		);
	});

	it('passes agent role prompt in context to sendToAI when provided in execute message', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'hello',
			agentRolePrompt: 'You are a coding assistant',
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'hello',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({
				currentNoteId: 'note-1',
				currentNoteTitle: 'Test Note',
				agentRolePrompt: 'You are a coding assistant',
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('returns stored agent roles when getAgentRoles message is received', async () => {
		const mockRoles = [{ id: '1', name: 'Coder', systemPrompt: 'You are a coding assistant' }];
		mockSettingsValue.mockResolvedValue(JSON.stringify(mockRoles));

		await capturedOnMessageCallback({ type: 'getAgentRoles' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'agentRoles',
				roles: mockRoles,
			}),
		);
	});

	it('returns empty array when no agent roles are stored', async () => {
		mockSettingsValue.mockResolvedValue('');

		await capturedOnMessageCallback({ type: 'getAgentRoles' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'agentRoles',
				roles: [],
			}),
		);
	});

	it('saves agent roles to settings when saveAgentRoles message is received', async () => {
		const roles = [{ id: '1', name: 'Writer', systemPrompt: 'You are a writing coach' }];

		await capturedOnMessageCallback({ type: 'saveAgentRoles', roles });

		expect(mockSettingsSetValue).toHaveBeenCalledWith(
			SETTING_KEYS.agentRoles,
			JSON.stringify(roles),
		);
	});

	it('sends updated roles back to panel after saving', async () => {
		const roles = [{ id: '1', name: 'Writer', systemPrompt: 'You are a writing coach' }];

		await capturedOnMessageCallback({ type: 'saveAgentRoles', roles });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'agentRoles',
				roles,
			}),
		);
	});

	it('saves applied role ID to settings when saveAppliedRoleId message is received', async () => {
		await capturedOnMessageCallback({ type: 'saveAppliedRoleId', roleId: 'role_123' });

		expect(mockSettingsSetValue).toHaveBeenCalledWith(SETTING_KEYS.appliedRoleId, 'role_123');
	});

	it('clears applied role ID in settings when saveAppliedRoleId is sent with null', async () => {
		await capturedOnMessageCallback({ type: 'saveAppliedRoleId', roleId: null });

		expect(mockSettingsSetValue).toHaveBeenCalledWith(SETTING_KEYS.appliedRoleId, '');
	});

	it('includes appliedRoleId when sending agent roles', async () => {
		const mockRoles = [{ id: 'r1', name: 'Coder', systemPrompt: 'You code' }];
		mockSettingsValue.mockImplementation((key: string) => {
			if (key === SETTING_KEYS.agentRoles) return Promise.resolve(JSON.stringify(mockRoles));
			if (key === SETTING_KEYS.appliedRoleId) return Promise.resolve('r1');
			return Promise.resolve('');
		});

		await capturedOnMessageCallback({ type: 'getAgentRoles' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'agentRoles',
				roles: mockRoles,
				appliedRoleId: 'r1',
			}),
		);
	});

	it('sends contextSize message after successful execute', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'hello' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'contextSize',
				usedTokens: expect.any(Number),
				maxTokens: expect.any(Number),
				percentage: expect.any(Number),
			}),
		);
	});

	it('passes workMode from execute message to sendToAI context', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'hello',
			workMode: 'ask',
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'hello',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({
				currentNoteId: 'note-1',
				currentNoteTitle: 'Test Note',
				workMode: 'ask',
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('passes workMode "edit" from execute message to sendToAI context', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'fix the command',
			workMode: 'edit',
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'fix the command',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({
				workMode: 'edit',
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('defaults workMode to "agent" when not provided in execute message', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'hello',
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'hello',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({
				workMode: 'agent',
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('resolves @[Title] note references and passes referenced notes to sendToAI', async () => {
		mockDataGet.mockImplementation((args: string[], opts?: Record<string, unknown>) => {
			if (Array.isArray(args) && args[0] === 'folders') {
				return Promise.resolve({ items: [] });
			}
			if (Array.isArray(args) && args[0] === 'search') {
				return Promise.resolve({
					items: [{ id: 'ref-1', title: 'Design Doc', parent_id: 'f1' }],
				});
			}
			if (Array.isArray(args) && args[0] === 'notes' && args[1] === 'ref-1') {
				return Promise.resolve({
					id: 'ref-1',
					title: 'Design Doc',
					body: 'Design document content here.',
				});
			}
			return Promise.resolve({ id: 'note-1', title: 'Test Note', body: 'Some existing content.' });
		});

		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'Summarize @[Design Doc] for me',
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'Summarize Design Doc for me',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({
				currentNoteId: 'note-1',
				referencedNotes: [
					expect.objectContaining({
						id: 'ref-1',
						title: 'Design Doc',
						body: 'Design document content here.',
					}),
				],
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('passes empty referencedNotes when prompt has no @[] references', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'hello',
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			'hello',
			expect.anything(),
			expect.anything(),
			expect.objectContaining({ referencedNotes: [] }),
			undefined,
			undefined,
			undefined,
		);
	});

	it('handles searchNotes message and returns matching notes', async () => {
		mockDataGet.mockResolvedValue({
			items: [
				{ id: 's1', title: 'Design Doc', parent_id: 'f1' },
				{ id: 's2', title: 'Design Spec', parent_id: 'f2' },
			],
		});

		await capturedOnMessageCallback({
			type: 'searchNotes',
			query: 'Design',
		});

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'noteSearchResults',
				notes: [
					expect.objectContaining({ id: 's1', title: 'Design Doc' }),
					expect.objectContaining({ id: 's2', title: 'Design Spec' }),
				],
			}),
		);
	});

	it('uses contains-matching search (not prefix-only) for searchNotes', async () => {
		mockDataGet.mockResolvedValue({ items: [] });

		await capturedOnMessageCallback({
			type: 'searchNotes',
			query: 'dog',
		});

		expect(mockDataGet).toHaveBeenCalledWith(
			['search'],
			expect.objectContaining({
				query: expect.stringContaining('dog'),
			}),
		);
		const searchCall = mockDataGet.mock.calls.find(
			(call: any[]) => Array.isArray(call[0]) && call[0][0] === 'search',
		);
		expect(searchCall).toBeDefined();
		const searchQuery = searchCall![1].query as string;
		expect(searchQuery).toBe('title:*dog*');
	});

	it('returns empty results for searchNotes when no matches', async () => {
		mockDataGet.mockResolvedValue({ items: [] });

		await capturedOnMessageCallback({
			type: 'searchNotes',
			query: 'nonexistent',
		});

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'noteSearchResults',
				notes: [],
			}),
		);
	});

	it('passes attachedFiles in context to sendToAI when provided in execute message', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'I analyzed the file.',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		const attachedFiles = [
			{ name: 'data.csv', content: 'col1,col2\n1,2', mimeType: 'text/csv', size: 14 },
		];

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'Analyze this file',
			attachedFiles,
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'Analyze this file',
			'Test Note',
			'Some existing content.',
			expect.objectContaining({
				currentNoteId: 'note-1',
				attachedFiles: [
					expect.objectContaining({
						name: 'data.csv',
						content: 'col1,col2\n1,2',
					}),
				],
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('passes empty attachedFiles when none provided in execute message', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'hello',
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			'hello',
			expect.anything(),
			expect.anything(),
			expect.not.objectContaining({ attachedFiles: expect.anything() }),
			undefined,
			undefined,
			undefined,
		);
	});

	it('passes multiple attachedFiles to sendToAI', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		const attachedFiles = [
			{ name: 'file1.txt', content: 'content1', mimeType: 'text/plain', size: 8 },
			{ name: 'file2.json', content: '{"key":"val"}', mimeType: 'application/json', size: 13 },
		];

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'compare these files',
			attachedFiles,
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything(),
			'compare these files',
			expect.anything(),
			expect.anything(),
			expect.objectContaining({
				attachedFiles: expect.arrayContaining([
					expect.objectContaining({ name: 'file1.txt' }),
					expect.objectContaining({ name: 'file2.json' }),
				]),
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('sends contextSize when note info is requested', async () => {
		await capturedOnMessageCallback({ type: 'getNote' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'contextSize',
				usedTokens: expect.any(Number),
				maxTokens: expect.any(Number),
				percentage: expect.any(Number),
			}),
		);
	});

	it('contextSize usedTokens is greater than 0 for a note with content', async () => {
		await capturedOnMessageCallback({ type: 'getNote' });

		const contextSizeCall = mockPostMessage.mock.calls.find(
			(call: unknown[]) => (call[1] as { type: string }).type === 'contextSize',
		);
		expect(contextSizeCall).toBeDefined();
		const data = contextSizeCall![1] as {
			type: string;
			usedTokens: number;
			maxTokens: number;
			percentage: number;
		};
		expect(data.usedTokens).toBeGreaterThan(0);
		expect(data.maxTokens).toBeGreaterThan(0);
		expect(data.percentage).toBeGreaterThanOrEqual(0);
		expect(data.percentage).toBeLessThanOrEqual(100);
	});

	it('includes modelName in result message', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'hello' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'result',
				modelName: 'GPT-4o',
			}),
		);
	});

	it('includes correct modelName for perplexity sonar-pro', async () => {
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'perplexity',
			[SETTING_KEYS.openaiKey]: '',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeModel]: 'claude-sonnet-4-20250514',
			[SETTING_KEYS.perplexityKey]: 'pplx-key',
			[SETTING_KEYS.perplexityModel]: 'sonar-pro',
		});

		mockedSendToAI.mockResolvedValue({
			content: 'answer',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'test' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'result',
				modelName: 'Sonar Pro',
			}),
		);
	});

	it('includes correct modelName for claude opus 4', async () => {
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'claude',
			[SETTING_KEYS.openaiKey]: '',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: 'sk-ant-key',
			[SETTING_KEYS.claudeModel]: 'claude-opus-4-20250514',
			[SETTING_KEYS.perplexityModel]: 'sonar',
		});

		mockedSendToAI.mockResolvedValue({
			content: 'answer',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'test' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'result',
				modelName: 'Claude Opus 4',
			}),
		);
	});

	it('does not send modelInfo message type (removed)', async () => {
		await capturedOnMessageCallback({ type: 'getNote' });

		const types = mockPostMessage.mock.calls.map(
			(call: unknown[]) => (call[1] as { type: string }).type,
		);
		expect(types).not.toContain('modelInfo');
	});

	it('sends fileSizeLimit when getFileSizeLimit message is received', async () => {
		mockSettingsValue.mockResolvedValue(10);

		await capturedOnMessageCallback({ type: 'getFileSizeLimit' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'fileSizeLimit',
				limitBytes: 10 * 1024 * 1024,
			}),
		);
	});

	it('sends fileSizeLimit with custom value from settings', async () => {
		mockSettingsValue.mockResolvedValue(25);

		await capturedOnMessageCallback({ type: 'getFileSizeLimit' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'fileSizeLimit',
				limitBytes: 25 * 1024 * 1024,
			}),
		);
	});

	it('defaults to 10 MB when fileMaxSizeMb setting is not configured', async () => {
		mockSettingsValue.mockResolvedValue(undefined);

		await capturedOnMessageCallback({ type: 'getFileSizeLimit' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'fileSizeLimit',
				limitBytes: 10 * 1024 * 1024,
			}),
		);
	});

	it('posts thinkingStep message when onThinkingStep callback fires during execution', async () => {
		mockedSendToAI.mockImplementation(
			async (_provider, _key, _model, _prompt, _title, _body, context) => {
				context?.onThinkingStep?.({ step: 'search_notes', label: 'Searching notes...' });
				return { content: 'result', isEdit: false, editedBody: undefined, actions: [] };
			},
		);

		await capturedOnMessageCallback({ type: 'execute', prompt: 'find my notes' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'thinkingStep',
				step: 'search_notes',
				label: 'Searching notes...',
			}),
		);
	});

	it('posts multiple thinkingStep messages for sequential tool calls', async () => {
		mockedSendToAI.mockImplementation(
			async (_provider, _key, _model, _prompt, _title, _body, context) => {
				context?.onThinkingStep?.({ step: 'search_notes', label: 'Searching notes...' });
				context?.onThinkingStep?.({ step: 'create_note', label: 'Creating note...' });
				return { content: 'done', isEdit: false, editedBody: undefined, actions: [] };
			},
		);

		await capturedOnMessageCallback({ type: 'execute', prompt: 'find and create' });

		const thinkingStepCalls = mockPostMessage.mock.calls.filter(
			(call: unknown[]) => (call[1] as { type: string }).type === 'thinkingStep',
		);
		expect(thinkingStepCalls).toHaveLength(2);
		expect(thinkingStepCalls[0][1]).toMatchObject({ step: 'search_notes' });
		expect(thinkingStepCalls[1][1]).toMatchObject({ step: 'create_note' });
	});

	it('extracts text from base64 PDF via pdfjs-dist before sending to AI', async () => {
		mockExtractPdf.mockResolvedValue('Extracted PDF content');
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'summarize the pdf',
			attachedFiles: [
				{
					name: 'report.pdf',
					content: '[PDF document]',
					mimeType: 'application/pdf',
					size: 1024,
					base64Data: 'JVBERi0xLjQ=',
				},
			],
		});

		expect(mockExtractPdf).toHaveBeenCalledWith('JVBERi0xLjQ=');
		const sendCall = mockedSendToAI.mock.calls[0];
		const context = sendCall[6];
		const file = context.attachedFiles![0];
		expect(file.content).toBe('Extracted PDF content');
		expect(file.base64Data).toBeUndefined();
	});

	it('keeps base64Data when pdfjs-dist extraction fails', async () => {
		mockExtractPdf.mockRejectedValue(new Error('corrupt PDF'));
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'summarize',
			attachedFiles: [
				{
					name: 'bad.pdf',
					content: '[PDF document]',
					mimeType: 'application/pdf',
					size: 500,
					base64Data: 'aW52YWxpZA==',
				},
			],
		});

		const sendCall = mockedSendToAI.mock.calls[0];
		const context = sendCall[6];
		const file = context.attachedFiles![0];
		expect(file.base64Data).toBe('aW52YWxpZA==');
	});

	it('keeps base64Data when pdfjs-dist returns empty text', async () => {
		mockExtractPdf.mockResolvedValue('   ');
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'read this',
			attachedFiles: [
				{
					name: 'scan.pdf',
					content: '[PDF document]',
					mimeType: 'application/pdf',
					size: 2048,
					base64Data: 'c2Nhbm5lZA==',
				},
			],
		});

		const sendCall = mockedSendToAI.mock.calls[0];
		const context = sendCall[6];
		const file = context.attachedFiles![0];
		expect(file.base64Data).toBe('c2Nhbm5lZA==');
	});

	it('skips pdfjs-dist extraction for non-PDF attached files', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'check this',
			attachedFiles: [
				{
					name: 'readme.txt',
					content: 'hello world',
					mimeType: 'text/plain',
					size: 11,
				},
			],
		});

		expect(mockExtractPdf).not.toHaveBeenCalled();
	});

	it('uses noteId from execute message to fetch note instead of getCurrentNote', async () => {
		mockDataGet.mockImplementation((args: string[]) => {
			if (Array.isArray(args) && args[0] === 'folders') {
				return Promise.resolve({ items: [] });
			}
			if (Array.isArray(args) && args[0] === 'notes' && args[1] === 'note-original') {
				return Promise.resolve({
					id: 'note-original',
					title: 'Original Note',
					body: 'Original content.',
				});
			}
			return Promise.resolve({
				id: 'note-1',
				title: 'Test Note',
				body: 'Some existing content.',
			});
		});
		mockSelectedNote.mockResolvedValue({ id: 'note-switched' });

		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'summarize',
			noteId: 'note-original',
		});

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'summarize',
			'Original Note',
			'Original content.',
			expect.objectContaining({
				currentNoteId: 'note-original',
				currentNoteTitle: 'Original Note',
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('does not call selectedNote when noteId is provided in execute message', async () => {
		mockDataGet.mockImplementation((args: string[]) => {
			if (Array.isArray(args) && args[0] === 'folders') {
				return Promise.resolve({ items: [] });
			}
			if (Array.isArray(args) && args[0] === 'notes' && args[1] === 'note-pinned') {
				return Promise.resolve({
					id: 'note-pinned',
					title: 'Pinned Note',
					body: 'Pinned body.',
				});
			}
			return Promise.resolve({ id: 'note-1', title: 'Test Note', body: 'Some existing content.' });
		});

		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		mockSelectedNote.mockClear();

		await capturedOnMessageCallback({
			type: 'execute',
			prompt: 'hello',
			noteId: 'note-pinned',
		});

		expect(mockSelectedNote).not.toHaveBeenCalled();
	});
});

describe('editor selection as AI context', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE);
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test-key',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Full note body with lots of content.',
		});
		await initPanel();
	});

	afterEach(() => {
		setEditorSelection('');
	});

	it('sends full note body with selectionText in context when editor has a selection', async () => {
		setEditorSelection('selected fragment');
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'explain this' });

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'explain this',
			'Test Note',
			'Full note body with lots of content.',
			expect.objectContaining({
				currentNoteId: 'note-1',
				isSelection: true,
				selectionText: 'selected fragment',
			}),
			undefined,
			undefined,
			undefined,
		);
	});

	it('sends full note body when editor selection is empty', async () => {
		setEditorSelection('');
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'explain this' });

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'explain this',
			'Test Note',
			'Full note body with lots of content.',
			expect.objectContaining({ currentNoteId: 'note-1' }),
			undefined,
			undefined,
			undefined,
		);
	});

	it('sends full note body when editor selection is only whitespace', async () => {
		setEditorSelection('   \n  ');
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'explain' });

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'explain',
			'Test Note',
			'Full note body with lots of content.',
			expect.objectContaining({ currentNoteId: 'note-1' }),
			undefined,
			undefined,
			undefined,
		);
	});

	it('passes isSelection flag in context when selection is active', async () => {
		setEditorSelection('selected fragment');
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'explain' });

		const context = mockedSendToAI.mock.calls[0][6];
		expect(context).toHaveProperty('isSelection', true);
	});

	it('does not pass isSelection flag when no selection', async () => {
		setEditorSelection('');
		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'explain' });

		const context = mockedSendToAI.mock.calls[0][6];
		expect(context?.isSelection).toBeFalsy();
	});

	it('sends selectionInfo to chat panel when selection changes and panel is visible', async () => {
		await togglePanel();
		mockPostMessage.mockClear();

		setEditorSelection('some highlighted text');

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'selectionInfo',
				hasSelection: true,
				length: 21,
			}),
		);
	});

	it('sends selectionInfo with hasSelection false when selection is cleared', async () => {
		await togglePanel();
		mockPostMessage.mockClear();

		setEditorSelection('');

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'selectionInfo',
				hasSelection: false,
				length: 0,
			}),
		);
	});

	it('does not send selectionInfo when chat panel is not visible', async () => {
		mockPostMessage.mockClear();

		setEditorSelection('text');

		const selectionCalls = mockPostMessage.mock.calls.filter(
			(call: unknown[]) => (call[1] as { type: string }).type === 'selectionInfo',
		);
		expect(selectionCalls).toHaveLength(0);
	});

	it('clears editor selection and sends selectionInfo when clearSelection message is received', async () => {
		setEditorSelection('some highlighted text');
		await togglePanel();
		mockPostMessage.mockClear();

		await capturedOnMessageCallback({ type: 'clearSelection' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'selectionInfo',
				hasSelection: false,
				length: 0,
			}),
		);
	});

	it('uses full note body for AI after clearSelection', async () => {
		setEditorSelection('selected fragment');
		await togglePanel();

		await capturedOnMessageCallback({ type: 'clearSelection' });

		mockedSendToAI.mockResolvedValue({
			content: 'ok',
			isEdit: false,
			editedBody: undefined,
			actions: [],
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'explain this' });

		expect(mockedSendToAI).toHaveBeenCalledWith(
			'openai',
			'sk-test-key',
			'gpt-4o',
			'explain this',
			'Test Note',
			'Full note body with lots of content.',
			expect.objectContaining({ currentNoteId: 'note-1' }),
			undefined,
			undefined,
			undefined,
		);
	});
});

describe('triggerAskAI', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE);
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test-key',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Some existing content.',
		});
		await initPanel();
	});

	it('opens the AI chat panel if it is not visible', async () => {
		const showSpy = jest.spyOn((await import('api')).default.views.panels, 'show');
		await triggerAskAI('selected text');
		expect(showSpy).toHaveBeenCalledWith(MOCK_CHAT_HANDLE);
	});

	it('does not hide and re-show the panel if it is already visible', async () => {
		await togglePanel();
		const showSpy = jest.spyOn((await import('api')).default.views.panels, 'show');
		showSpy.mockClear();
		await triggerAskAI('selected text');
		expect(showSpy).not.toHaveBeenCalled();
	});

	it('sends triggerAskAI message with selected text to the chat panel', async () => {
		await triggerAskAI('my selected text');
		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_CHAT_HANDLE,
			expect.objectContaining({
				type: 'triggerAskAI',
				text: 'my selected text',
			}),
		);
	});

	it('sets the editor selection to the provided text', async () => {
		await triggerAskAI('hello world');
		const selectionInfoCalls = mockPostMessage.mock.calls.filter(
			(call: unknown[]) => (call[1] as { type: string }).type === 'selectionInfo',
		);
		const lastSelectionCall = selectionInfoCalls[selectionInfoCalls.length - 1];
		expect(lastSelectionCall).toBeDefined();
		expect(lastSelectionCall[1]).toMatchObject({
			type: 'selectionInfo',
			hasSelection: true,
			length: 11,
		});
	});

	it('does nothing when called with empty text', async () => {
		mockPostMessage.mockClear();
		await triggerAskAI('');
		const triggerCalls = mockPostMessage.mock.calls.filter(
			(call: unknown[]) => (call[1] as { type: string }).type === 'triggerAskAI',
		);
		expect(triggerCalls).toHaveLength(0);
	});

	it('does nothing when called with whitespace-only text', async () => {
		mockPostMessage.mockClear();
		await triggerAskAI('   \n  ');
		const triggerCalls = mockPostMessage.mock.calls.filter(
			(call: unknown[]) => (call[1] as { type: string }).type === 'triggerAskAI',
		);
		expect(triggerCalls).toHaveLength(0);
	});
});

describe('settings message handlers', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		mockCreate.mockResolvedValueOnce(MOCK_CHAT_HANDLE);
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test-key',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
		});
		mockSelectedNote.mockResolvedValue({ id: 'note-1' });
		mockDataGet.mockResolvedValue({
			id: 'note-1',
			title: 'Test Note',
			body: 'Some existing content.',
		});
		await initPanel();
	});

	it('returns current AI settings when getSettings message is received', async () => {
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-test-key',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: '',
			[SETTING_KEYS.claudeModel]: 'claude-sonnet-4-20250514',
			[SETTING_KEYS.perplexityKey]: '',
			[SETTING_KEYS.perplexityModel]: 'sonar',
			[SETTING_KEYS.webSearchEnabled]: false,
			[SETTING_KEYS.webSearchModel]: 'openai:gpt-4o-search-preview',
			[SETTING_KEYS.kieApiKey]: '',
			[SETTING_KEYS.imageGenModel]: 'gpt-image/1.5-text-to-image',
			[SETTING_KEYS.fileMaxSizeMb]: 10,
		});

		await capturedOnMessageCallback({ type: 'getSettings' });

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'settingsData',
				provider: 'openai',
				openaiModel: 'gpt-4o',
				claudeModel: 'claude-sonnet-4-20250514',
				perplexityModel: 'sonar',
				webSearchEnabled: false,
			}),
		);
	});

	it('masks API keys — sends keySet booleans instead of actual values', async () => {
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-secret-key',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: 'sk-ant-secret',
			[SETTING_KEYS.claudeModel]: 'claude-sonnet-4-20250514',
			[SETTING_KEYS.perplexityKey]: '',
			[SETTING_KEYS.perplexityModel]: 'sonar',
			[SETTING_KEYS.webSearchEnabled]: true,
			[SETTING_KEYS.webSearchModel]: 'openai:gpt-4o-search-preview',
			[SETTING_KEYS.kieApiKey]: 'kie-key-value',
			[SETTING_KEYS.imageGenModel]: 'gpt-image/1.5-text-to-image',
			[SETTING_KEYS.fileMaxSizeMb]: 10,
		});

		await capturedOnMessageCallback({ type: 'getSettings' });

		const settingsCall = mockPostMessage.mock.calls.find(
			(call: unknown[]) => (call[1] as { type: string }).type === 'settingsData',
		);
		expect(settingsCall).toBeDefined();
		const data = settingsCall![1] as Record<string, unknown>;
		expect(data.openaiKeySet).toBe(true);
		expect(data.claudeKeySet).toBe(true);
		expect(data.perplexityKeySet).toBe(false);
		expect(data.kieKeySet).toBe(true);
		expect(data).not.toHaveProperty('openaiKey');
		expect(data).not.toHaveProperty('claudeKey');
		expect(data).not.toHaveProperty('perplexityKey');
		expect(data).not.toHaveProperty('kieApiKey');
	});

	it('saves settings when saveSettings message is received', async () => {
		await capturedOnMessageCallback({
			type: 'saveSettings',
			settings: {
				[SETTING_KEYS.provider]: 'claude',
				[SETTING_KEYS.claudeModel]: 'claude-opus-4-20250514',
			},
		});

		expect(mockSettingsSetValue).toHaveBeenCalledWith(SETTING_KEYS.provider, 'claude');
		expect(mockSettingsSetValue).toHaveBeenCalledWith(
			SETTING_KEYS.claudeModel,
			'claude-opus-4-20250514',
		);
	});

	it('sends updated settingsData back after saving settings', async () => {
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'claude',
			[SETTING_KEYS.openaiKey]: '',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: 'sk-ant-key',
			[SETTING_KEYS.claudeModel]: 'claude-opus-4-20250514',
			[SETTING_KEYS.perplexityKey]: '',
			[SETTING_KEYS.perplexityModel]: 'sonar',
			[SETTING_KEYS.webSearchEnabled]: false,
			[SETTING_KEYS.webSearchModel]: 'openai:gpt-4o-search-preview',
			[SETTING_KEYS.kieApiKey]: '',
			[SETTING_KEYS.imageGenModel]: 'gpt-image/1.5-text-to-image',
			[SETTING_KEYS.fileMaxSizeMb]: 10,
		});

		await capturedOnMessageCallback({
			type: 'saveSettings',
			settings: { [SETTING_KEYS.provider]: 'claude' },
		});

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'settingsData',
				provider: 'claude',
			}),
		);
	});

	it('includes dropdown options in settingsData response', async () => {
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: '',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: '',
			[SETTING_KEYS.claudeModel]: 'claude-sonnet-4-20250514',
			[SETTING_KEYS.perplexityKey]: '',
			[SETTING_KEYS.perplexityModel]: 'sonar',
			[SETTING_KEYS.webSearchEnabled]: false,
			[SETTING_KEYS.webSearchModel]: 'openai:gpt-4o-search-preview',
			[SETTING_KEYS.kieApiKey]: '',
			[SETTING_KEYS.imageGenModel]: 'gpt-image/1.5-text-to-image',
			[SETTING_KEYS.fileMaxSizeMb]: 10,
		});

		await capturedOnMessageCallback({ type: 'getSettings' });

		const settingsCall = mockPostMessage.mock.calls.find(
			(call: unknown[]) => (call[1] as { type: string }).type === 'settingsData',
		);
		const data = settingsCall![1] as Record<string, unknown>;
		expect(data.providerOptions).toBeDefined();
		expect(data.openaiModelOptions).toBeDefined();
		expect(data.claudeModelOptions).toBeDefined();
		expect(data.perplexityModelOptions).toBeDefined();
	});

	it('only saves allowed setting keys — ignores unknown keys', async () => {
		await capturedOnMessageCallback({
			type: 'saveSettings',
			settings: {
				[SETTING_KEYS.provider]: 'openai',
				unknownKey: 'should-be-ignored',
			},
		});

		expect(mockSettingsSetValue).toHaveBeenCalledWith(SETTING_KEYS.provider, 'openai');
		expect(mockSettingsSetValue).not.toHaveBeenCalledWith('unknownKey', expect.anything());
	});

	it('saves settings sequentially to avoid SQLITE_CONSTRAINT race condition', async () => {
		const callLog: Array<{ key: string; phase: 'start' | 'end' }> = [];
		mockSettingsSetValue.mockImplementation(async (key: string) => {
			callLog.push({ key, phase: 'start' });
			await new Promise((r) => setTimeout(r, 10));
			callLog.push({ key, phase: 'end' });
		});

		await capturedOnMessageCallback({
			type: 'saveSettings',
			settings: {
				[SETTING_KEYS.provider]: 'claude',
				[SETTING_KEYS.claudeModel]: 'claude-opus-4-20250514',
			},
		});

		const startIndices = callLog
			.map((entry, i) => (entry.phase === 'start' ? i : -1))
			.filter((i) => i >= 0);
		const endIndices = callLog
			.map((entry, i) => (entry.phase === 'end' ? i : -1))
			.filter((i) => i >= 0);
		for (let i = 1; i < startIndices.length; i++) {
			expect(startIndices[i]).toBeGreaterThan(endIndices[i - 1]);
		}
	});

	it('refreshes context size after saving settings', async () => {
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: 'sk-key',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: '',
			[SETTING_KEYS.claudeModel]: 'claude-sonnet-4-20250514',
			[SETTING_KEYS.perplexityKey]: '',
			[SETTING_KEYS.perplexityModel]: 'sonar',
			[SETTING_KEYS.webSearchEnabled]: false,
			[SETTING_KEYS.webSearchModel]: 'openai:gpt-4o-search-preview',
			[SETTING_KEYS.kieApiKey]: '',
			[SETTING_KEYS.imageGenModel]: 'gpt-image/1.5-text-to-image',
			[SETTING_KEYS.fileMaxSizeMb]: 10,
		});

		await capturedOnMessageCallback({
			type: 'saveSettings',
			settings: { [SETTING_KEYS.openaiModel]: 'gpt-4o-mini' },
		});

		const types = mockPostMessage.mock.calls.map(
			(call: unknown[]) => (call[1] as { type: string }).type,
		);
		expect(types).toContain('contextSize');
	});

	it('retries setValue when SQLITE_CONSTRAINT error is thrown', async () => {
		const sqliteError = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.key');
		let callCount = 0;
		mockSettingsSetValue.mockImplementation(async () => {
			callCount++;
			if (callCount <= 1) throw sqliteError;
		});
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'claude',
			[SETTING_KEYS.openaiKey]: '',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: '',
			[SETTING_KEYS.claudeModel]: 'claude-sonnet-4-20250514',
			[SETTING_KEYS.perplexityKey]: '',
			[SETTING_KEYS.perplexityModel]: 'sonar',
			[SETTING_KEYS.webSearchEnabled]: false,
			[SETTING_KEYS.webSearchModel]: 'openai:gpt-4o-search-preview',
			[SETTING_KEYS.kieApiKey]: '',
			[SETTING_KEYS.imageGenModel]: 'gpt-image/1.5-text-to-image',
			[SETTING_KEYS.fileMaxSizeMb]: 10,
		});

		await capturedOnMessageCallback({
			type: 'saveSettings',
			settings: { [SETTING_KEYS.provider]: 'claude' },
		});

		expect(mockSettingsSetValue).toHaveBeenCalledTimes(2);
		expect(mockSettingsSetValue).toHaveBeenCalledWith(SETTING_KEYS.provider, 'claude');
	});

	it('does not retry on non-SQLITE errors — propagates gracefully', async () => {
		const genericError = new Error('Network error');
		mockSettingsSetValue.mockRejectedValue(genericError);
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: '',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: '',
			[SETTING_KEYS.claudeModel]: 'claude-sonnet-4-20250514',
			[SETTING_KEYS.perplexityKey]: '',
			[SETTING_KEYS.perplexityModel]: 'sonar',
			[SETTING_KEYS.webSearchEnabled]: false,
			[SETTING_KEYS.webSearchModel]: 'openai:gpt-4o-search-preview',
			[SETTING_KEYS.kieApiKey]: '',
			[SETTING_KEYS.imageGenModel]: 'gpt-image/1.5-text-to-image',
			[SETTING_KEYS.fileMaxSizeMb]: 10,
		});

		await capturedOnMessageCallback({
			type: 'saveSettings',
			settings: { [SETTING_KEYS.provider]: 'claude' },
		});

		expect(mockSettingsSetValue).toHaveBeenCalledTimes(1);
	});

	it('gives up after max retries on persistent SQLITE_CONSTRAINT error', async () => {
		const sqliteError = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.key');
		mockSettingsSetValue.mockRejectedValue(sqliteError);
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: '',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: '',
			[SETTING_KEYS.claudeModel]: 'claude-sonnet-4-20250514',
			[SETTING_KEYS.perplexityKey]: '',
			[SETTING_KEYS.perplexityModel]: 'sonar',
			[SETTING_KEYS.webSearchEnabled]: false,
			[SETTING_KEYS.webSearchModel]: 'openai:gpt-4o-search-preview',
			[SETTING_KEYS.kieApiKey]: '',
			[SETTING_KEYS.imageGenModel]: 'gpt-image/1.5-text-to-image',
			[SETTING_KEYS.fileMaxSizeMb]: 10,
		});

		await capturedOnMessageCallback({
			type: 'saveSettings',
			settings: { [SETTING_KEYS.provider]: 'claude' },
		});

		expect(mockSettingsSetValue).toHaveBeenCalledTimes(3);
	});

	it('sends settingsError to webview when save fails after all retries', async () => {
		const sqliteError = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.key');
		mockSettingsSetValue.mockRejectedValue(sqliteError);
		mockSettingsValues.mockResolvedValue({
			[SETTING_KEYS.provider]: 'openai',
			[SETTING_KEYS.openaiKey]: '',
			[SETTING_KEYS.openaiModel]: 'gpt-4o',
			[SETTING_KEYS.claudeKey]: '',
			[SETTING_KEYS.claudeModel]: 'claude-sonnet-4-20250514',
			[SETTING_KEYS.perplexityKey]: '',
			[SETTING_KEYS.perplexityModel]: 'sonar',
			[SETTING_KEYS.webSearchEnabled]: false,
			[SETTING_KEYS.webSearchModel]: 'openai:gpt-4o-search-preview',
			[SETTING_KEYS.kieApiKey]: '',
			[SETTING_KEYS.imageGenModel]: 'gpt-image/1.5-text-to-image',
			[SETTING_KEYS.fileMaxSizeMb]: 10,
		});

		await capturedOnMessageCallback({
			type: 'saveSettings',
			settings: { [SETTING_KEYS.provider]: 'claude' },
		});

		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'settingsError',
				message: expect.stringContaining('SQLITE_CONSTRAINT'),
			}),
		);
	});

	it('retries saveAgentRoles on SQLITE_CONSTRAINT error', async () => {
		const sqliteError = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.key');
		let callCount = 0;
		mockSettingsSetValue.mockImplementation(async () => {
			callCount++;
			if (callCount <= 1) throw sqliteError;
		});

		const roles = [{ id: 'role-1', name: 'Coder', prompt: 'You are a coder.' }];
		await capturedOnMessageCallback({ type: 'saveAgentRoles', roles });

		expect(mockSettingsSetValue).toHaveBeenCalledTimes(2);
		expect(mockSettingsSetValue).toHaveBeenCalledWith(
			SETTING_KEYS.agentRoles,
			JSON.stringify(roles),
		);
	});

	it('retries saveAppliedRoleId on SQLITE_CONSTRAINT error', async () => {
		const sqliteError = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.key');
		let callCount = 0;
		mockSettingsSetValue.mockImplementation(async () => {
			callCount++;
			if (callCount <= 1) throw sqliteError;
		});

		await capturedOnMessageCallback({ type: 'saveAppliedRoleId', roleId: 'role-1' });

		expect(mockSettingsSetValue).toHaveBeenCalledTimes(2);
		expect(mockSettingsSetValue).toHaveBeenCalledWith(SETTING_KEYS.appliedRoleId, 'role-1');
	});
});
