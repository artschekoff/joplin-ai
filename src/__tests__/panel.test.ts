import { SETTING_KEYS } from '../settings';

const MOCK_PANEL_HANDLE = 'panel-handle-123';

const mockPostMessage = jest.fn();
const mockCreate = jest.fn().mockResolvedValue(MOCK_PANEL_HANDLE);
const mockSettingsValues = jest.fn();
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
				actions: [
					expect.objectContaining({ action: 'update_note', success: true }),
				],
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
			{ currentNoteId: 'note-1', currentNoteTitle: 'Test Note' },
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
		const types = postMessageCalls.map(
			(call: unknown[]) => (call[1] as { type: string }).type,
		);
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
});
