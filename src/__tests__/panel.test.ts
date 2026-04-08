import { SETTING_KEYS } from '../settings';

const MOCK_PANEL_HANDLE = 'panel-handle-123';

const mockPostMessage = jest.fn();
const mockCreate = jest.fn().mockResolvedValue(MOCK_PANEL_HANDLE);
const mockSettingsValues = jest.fn();
const mockSelectedNote = jest.fn();
const mockDataGet = jest.fn();
const mockDataPut = jest.fn().mockResolvedValue(undefined);
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
			put: (...args: any[]) => mockDataPut(...args),
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

	it('updates note body to empty string when AI returns empty editedBody (text deletion)', async () => {
		mockedSendToAI.mockResolvedValue({
			content: '<note_edit></note_edit>',
			isEdit: true,
			editedBody: '',
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'delete all text' });

		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, { body: '' });
		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({ type: 'result', isEdit: true }),
		);
	});

	it('updates note body when AI returns non-empty editedBody', async () => {
		mockedSendToAI.mockResolvedValue({
			content: '<note_edit># Rewritten\nNew content.</note_edit>',
			isEdit: true,
			editedBody: '# Rewritten\nNew content.',
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'rewrite' });

		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			body: '# Rewritten\nNew content.',
		});
		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({ type: 'result', isEdit: true }),
		);
	});

	it('does not update note when AI response is not an edit', async () => {
		mockedSendToAI.mockResolvedValue({
			content: 'This note is about testing.',
			isEdit: false,
		});

		await capturedOnMessageCallback({ type: 'execute', prompt: 'what is this about?' });

		expect(mockDataPut).not.toHaveBeenCalled();
		expect(mockPostMessage).toHaveBeenCalledWith(
			MOCK_PANEL_HANDLE,
			expect.objectContaining({
				type: 'result',
				isEdit: false,
				content: 'This note is about testing.',
			}),
		);
	});
});
