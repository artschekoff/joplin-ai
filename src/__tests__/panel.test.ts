import { SETTING_KEYS } from '../settings';

const MOCK_PANEL_HANDLE = 'panel-handle-123';

const mockPostMessage = jest.fn();
const mockCreate = jest.fn().mockResolvedValue(MOCK_PANEL_HANDLE);
const mockSettingsValues = jest.fn();
const mockSettingsValue = jest.fn();
const mockSettingsSetValue = jest.fn().mockResolvedValue(undefined);
const mockSelectedNote = jest.fn();
const mockDataGet = jest.fn();
const mockOnNoteSelectionChange = jest.fn().mockResolvedValue(undefined);

let capturedOnMessageCallback: (message: any) => Promise<void>;

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
					.mockImplementation((_handle: string, cb: (...args: unknown[]) => void) => {
						capturedOnMessageCallback = cb as (message: any) => Promise<void>;
						return Promise.resolve();
					}),
				postMessage: (...args: any[]) => mockPostMessage(...args),
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
		},
	},
}));

jest.mock('../ai/service', () => ({
	sendToAI: jest.fn(),
	buildSystemPrompt: jest.fn(() => 'mocked system prompt with some content to estimate tokens'),
}));

import { initPanel } from '../panel';
import { sendToAI } from '../ai/service';

const mockedSendToAI = sendToAI as jest.MockedFunction<typeof sendToAI>;

describe('panel handleExecute', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		mockCreate.mockResolvedValue(MOCK_PANEL_HANDLE);
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
		);
	});

	it('fetches notebooks and passes them in action context', async () => {
		mockDataGet
			.mockResolvedValueOnce({ id: 'note-1', title: 'Test Note', body: 'Some existing content.' })
			.mockResolvedValueOnce({
				items: [
					{ id: 'f1', title: 'Work', parent_id: '' },
					{ id: 'f2', title: 'Personal', parent_id: '' },
				],
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
		);
	});

	it('passes empty notebooks array when no notebooks exist', async () => {
		mockDataGet
			.mockResolvedValueOnce({ id: 'note-1', title: 'Test Note', body: 'Some existing content.' })
			.mockResolvedValueOnce({ items: [] });

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
		);
	});

	it('resolves @[Title] note references and passes referenced notes to sendToAI', async () => {
		mockDataGet
			.mockResolvedValueOnce({ id: 'note-1', title: 'Test Note', body: 'Some existing content.' })
			.mockResolvedValueOnce({ items: [] })
			.mockResolvedValueOnce({
				items: [{ id: 'ref-1', title: 'Design Doc', parent_id: 'f1' }],
			})
			.mockResolvedValueOnce({
				id: 'ref-1',
				title: 'Design Doc',
				body: 'Design document content here.',
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
});
