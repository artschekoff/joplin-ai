import { ToolbarButtonLocation } from 'api/types';

const mockToolbarButtonsCreate = jest.fn().mockResolvedValue(undefined);
const mockMenuItemsCreate = jest.fn().mockResolvedValue(undefined);
const mockCommandsRegister = jest.fn().mockResolvedValue(undefined);
const mockContentScriptsRegister = jest.fn().mockResolvedValue(undefined);
const mockContentScriptsOnMessage = jest.fn().mockResolvedValue(undefined);
const mockPanelsCreate = jest.fn().mockResolvedValue('panel-handle-test');
const mockPanelsSetHtml = jest.fn().mockResolvedValue(undefined);
const mockPanelsAddScript = jest.fn().mockResolvedValue(undefined);
const mockPanelsHide = jest.fn().mockResolvedValue(undefined);
const mockPanelsOnMessage = jest.fn().mockResolvedValue(undefined);
const mockWorkspaceOnNoteSelectionChange = jest.fn().mockResolvedValue(undefined);
const mockSettingsRegisterSection = jest.fn().mockResolvedValue(undefined);
const mockSettingsRegisterSetting = jest.fn().mockResolvedValue(undefined);

let capturedOnStart: (() => Promise<void>) | null = null;

jest.mock('api', () => ({
	__esModule: true,
	default: {
		plugins: {
			register: jest.fn().mockImplementation((opts: { onStart: () => Promise<void> }) => {
				capturedOnStart = opts.onStart;
				return Promise.resolve();
			}),
		},
		commands: {
			register: (...args: unknown[]) => mockCommandsRegister(...args),
		},
		views: {
			panels: {
				create: (...args: unknown[]) => mockPanelsCreate(...args),
				setHtml: (...args: unknown[]) => mockPanelsSetHtml(...args),
				addScript: (...args: unknown[]) => mockPanelsAddScript(...args),
				hide: (...args: unknown[]) => mockPanelsHide(...args),
				show: jest.fn().mockResolvedValue(undefined),
				onMessage: (...args: unknown[]) => mockPanelsOnMessage(...args),
				postMessage: jest.fn().mockResolvedValue(undefined),
			},
			menuItems: {
				create: (...args: unknown[]) => mockMenuItemsCreate(...args),
			},
			toolbarButtons: {
				create: (...args: unknown[]) => mockToolbarButtonsCreate(...args),
			},
			dialogs: {
				showMessageBox: jest.fn().mockResolvedValue(undefined),
			},
		},
		settings: {
			registerSection: (...args: unknown[]) => mockSettingsRegisterSection(...args),
			registerSetting: (...args: unknown[]) => mockSettingsRegisterSetting(...args),
			registerSettings: jest.fn().mockResolvedValue(undefined),
			values: jest.fn().mockResolvedValue({}),
			value: jest.fn().mockResolvedValue(''),
			setValue: jest.fn().mockResolvedValue(undefined),
		},
		workspace: {
			selectedNote: jest.fn().mockResolvedValue(null),
			onNoteSelectionChange: (...args: unknown[]) => mockWorkspaceOnNoteSelectionChange(...args),
		},
		data: {
			get: jest.fn().mockResolvedValue({ items: [] }),
			put: jest.fn().mockResolvedValue(undefined),
		},
		contentScripts: {
			register: (...args: unknown[]) => mockContentScriptsRegister(...args),
			onMessage: (...args: unknown[]) => mockContentScriptsOnMessage(...args),
		},
	},
}));

jest.mock('../utils/share-note', () => ({
	shareNoteAsText: jest.fn().mockResolvedValue(undefined),
	openUrlInSystem: jest.fn().mockResolvedValue(undefined),
	buildPdfMailtoUrl: jest.fn().mockReturnValue('mailto:'),
	exportNoteWithPandoc: jest.fn().mockResolvedValue('/tmp/note.docx'),
}));

jest.mock('../ai/service', () => ({
	sendToAI: jest.fn(),
	buildSystemPrompt: jest.fn(() => 'mocked system prompt'),
}));

jest.mock('../utils/pdf-extract', () => ({
	extractPdfTextFromBase64: jest.fn(),
}));

import '../index';

describe('index onStart registration', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		mockPanelsCreate.mockResolvedValue('panel-handle-test');
		if (capturedOnStart) {
			await capturedOnStart();
		}
	});

	describe('editWithAI toolbar button', () => {
		it('should create a toolbar button for editWithAI in the NoteToolbar', () => {
			// Arrange
			const expectedButtonId = 'editWithAIBtn';
			const expectedCommandName = 'editWithAI';
			const expectedLocation = ToolbarButtonLocation.NoteToolbar;

			// Act — already executed in beforeEach

			// Assert
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				expectedButtonId,
				expectedCommandName,
				expectedLocation,
			);
		});

		it('should register the editWithAI command with the AI icon', () => {
			// Arrange
			const expectedCommandName = 'editWithAI';

			// Act — already executed in beforeEach

			// Assert
			expect(mockCommandsRegister).toHaveBeenCalledWith(
				expect.objectContaining({
					name: expectedCommandName,
					iconName: 'fas fa-robot',
				}),
			);
		});

		it('should place the editWithAI toolbar button before the block editor button', () => {
			// Arrange
			const allCalls = mockToolbarButtonsCreate.mock.calls;
			const aiButtonIdx = allCalls.findIndex((call) => call[1] === 'editWithAI');
			const blockEditorButtonIdx = allCalls.findIndex((call) => call[1] === 'enableBlockEditor');

			// Act — already executed in beforeEach

			// Assert
			expect(aiButtonIdx).toBeGreaterThanOrEqual(0);
			expect(blockEditorButtonIdx).toBeGreaterThanOrEqual(0);
			expect(aiButtonIdx).toBeLessThan(blockEditorButtonIdx);
		});
	});

	describe('toolbar button resilience when initSettings fails', () => {
		it('should register all toolbar buttons even when registerSettings throws SQLITE_CONSTRAINT', async () => {
			jest.clearAllMocks();
			mockPanelsCreate.mockResolvedValue('panel-handle-test');

			const joplinApi = require('api').default;
			(joplinApi.settings.registerSettings as jest.Mock).mockRejectedValueOnce(
				new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.key'),
			);

			await capturedOnStart!();

			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'editWithAIBtn',
				'editWithAI',
				ToolbarButtonLocation.NoteToolbar,
			);
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'enableBlockEditorBtn',
				'enableBlockEditor',
				ToolbarButtonLocation.NoteToolbar,
			);
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'exportNoteAsDocBtn',
				'exportNoteAsDoc',
				ToolbarButtonLocation.NoteToolbar,
			);
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'exportNoteAsRtfBtn',
				'exportNoteAsRtf',
				ToolbarButtonLocation.NoteToolbar,
			);
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'shareNoteAsPdfBtn',
				'shareNoteAsPdf',
				ToolbarButtonLocation.NoteToolbar,
			);
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'shareNoteAsTextBtn',
				'shareNoteAsText',
				ToolbarButtonLocation.NoteToolbar,
			);
		});

		it('should register all commands even when registerSettings throws', async () => {
			jest.clearAllMocks();
			mockPanelsCreate.mockResolvedValue('panel-handle-test');

			const joplinApi = require('api').default;
			(joplinApi.settings.registerSettings as jest.Mock).mockRejectedValueOnce(
				new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.key'),
			);

			await capturedOnStart!();

			expect(mockCommandsRegister).toHaveBeenCalledWith(
				expect.objectContaining({ name: 'editWithAI' }),
			);
			expect(mockCommandsRegister).toHaveBeenCalledWith(
				expect.objectContaining({ name: 'enableBlockEditor' }),
			);
			expect(mockCommandsRegister).toHaveBeenCalledWith(
				expect.objectContaining({ name: 'exportNoteAsDoc' }),
			);
			expect(mockCommandsRegister).toHaveBeenCalledWith(
				expect.objectContaining({ name: 'exportNoteAsRtf' }),
			);
		});

		it('should register toolbar buttons even when panel creation fails', async () => {
			jest.clearAllMocks();
			mockPanelsCreate.mockRejectedValue(new Error('Panel creation failed'));

			await capturedOnStart!();

			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'editWithAIBtn',
				'editWithAI',
				ToolbarButtonLocation.NoteToolbar,
			);
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'enableBlockEditorBtn',
				'enableBlockEditor',
				ToolbarButtonLocation.NoteToolbar,
			);
		});
	});

	describe('export toolbar buttons', () => {
		it('should register an exportNoteAsDoc command with Word icon', () => {
			expect(mockCommandsRegister).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'exportNoteAsDoc',
					iconName: 'fas fa-file-word',
				}),
			);
		});

		it('should register an exportNoteAsRtf command with file icon', () => {
			expect(mockCommandsRegister).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'exportNoteAsRtf',
					iconName: 'fas fa-file-alt',
				}),
			);
		});

		it('should create a toolbar button for exportNoteAsDoc', () => {
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'exportNoteAsDocBtn',
				'exportNoteAsDoc',
				ToolbarButtonLocation.NoteToolbar,
			);
		});

		it('should create a toolbar button for exportNoteAsRtf', () => {
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'exportNoteAsRtfBtn',
				'exportNoteAsRtf',
				ToolbarButtonLocation.NoteToolbar,
			);
		});

		it('should register PDF export command with label not containing "Email"', () => {
			const pdfCommand = mockCommandsRegister.mock.calls.find(
				(call: unknown[]) => (call[0] as { name: string }).name === 'shareNoteAsPdf',
			);
			expect(pdfCommand).toBeDefined();
			const label = (pdfCommand![0] as { label: string }).label;
			expect(label).not.toContain('Email');
			expect(label).toContain('PDF');
		});

		it('should create menu items for doc and rtf export in Tools', () => {
			expect(mockMenuItemsCreate).toHaveBeenCalledWith(
				'exportNoteAsDocMenuItem',
				'exportNoteAsDoc',
				expect.anything(),
			);
			expect(mockMenuItemsCreate).toHaveBeenCalledWith(
				'exportNoteAsRtfMenuItem',
				'exportNoteAsRtf',
				expect.anything(),
			);
		});
	});
});
