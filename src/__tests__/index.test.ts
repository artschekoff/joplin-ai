import * as path from 'path';
import * as fs from 'fs';
import joplin from 'api';
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

let capturedIntervalCallback: (() => Promise<void>) | null = null;
jest.spyOn(global, 'setInterval').mockImplementation(((cb: () => void) => {
	capturedIntervalCallback = cb as () => Promise<void>;
	return 0 as unknown as ReturnType<typeof setInterval>;
}) as typeof setInterval);
const mockSettingsOnChange = jest.fn().mockResolvedValue(undefined);
const mockSettingsGlobalValue = jest.fn().mockResolvedValue('');

const mockExecuteWithSelection = jest.fn().mockResolvedValue(undefined);
jest.mock('../panel', () => ({
	initPanel: jest.fn().mockResolvedValue(undefined),
	togglePanel: jest.fn().mockResolvedValue(undefined),
	executeWithSelection: (...args: unknown[]) => mockExecuteWithSelection(...args),
}));

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
			globalValue: (...args: unknown[]) => mockSettingsGlobalValue(...args),
			onChange: (...args: unknown[]) => mockSettingsOnChange(...args),
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

jest.mock('../ai/service', () => ({
	sendToAI: jest.fn(),
	buildSystemPrompt: jest.fn(() => 'mocked system prompt'),
	buildSystemPromptParts: jest.fn(() => ({
		staticInstructions: 'mocked static instructions',
		noteBodyContext: '\nCurrent note title: Test\nCurrent note content:\nmocked body',
		dynamicContext: '',
	})),
}));

jest.mock('../utils/pdf-extract', () => ({
	extractPdfTextFromBase64: jest.fn(),
}));

import '../index';

describe('manifest.json plugin identity', () => {
	const manifestPath = path.resolve(__dirname, '..', 'manifest.json');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

	it('should use the net.roxl.joplin-ai plugin identifier', () => {
		expect(manifest.id).toBe('net.roxl.joplin-ai');
	});
});

describe('index onStart registration', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		mockPanelsCreate.mockResolvedValue('panel-handle-test');
		if (capturedOnStart) {
			await capturedOnStart();
		}
	});

	describe('Joplin view toggle toolbar buttons', () => {
		it('should create a toolbar button for toggleSideBar in the NoteToolbar', () => {
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'toggleSideBarBtn',
				'toggleSideBar',
				ToolbarButtonLocation.NoteToolbar,
			);
		});

		it('should create a toolbar button for toggleNoteList in the NoteToolbar', () => {
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'toggleNoteListBtn',
				'toggleNoteList',
				ToolbarButtonLocation.NoteToolbar,
			);
		});
	});

	describe('editWithAI toolbar button', () => {
		it('should register the editWithAI command with the AI icon', () => {
			expect(mockCommandsRegister).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'editWithAI',
					iconName: 'fas fa-robot',
				}),
			);
		});
	});

	describe('toolbar button resilience when initSettings fails', () => {
		it('should register all toolbar buttons even when registerSettings throws SQLITE_CONSTRAINT', async () => {
			jest.clearAllMocks();
			mockPanelsCreate.mockResolvedValue('panel-handle-test');

			(joplin.settings.registerSettings as jest.Mock).mockRejectedValueOnce(
				new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.key'),
			);

			await capturedOnStart!();

			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'toggleSideBarBtn',
				'toggleSideBar',
				ToolbarButtonLocation.NoteToolbar,
			);
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'toggleNoteListBtn',
				'toggleNoteList',
				ToolbarButtonLocation.NoteToolbar,
			);
		});

		it('should register all commands even when registerSettings throws', async () => {
			jest.clearAllMocks();
			mockPanelsCreate.mockResolvedValue('panel-handle-test');
			(joplin.settings.registerSettings as jest.Mock).mockRejectedValueOnce(
				new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: settings.key'),
			);

			await capturedOnStart!();

			expect(mockCommandsRegister).toHaveBeenCalledWith(
				expect.objectContaining({ name: 'editWithAI' }),
			);
		});

		it('should register toolbar buttons even when panel creation fails', async () => {
			jest.clearAllMocks();
			mockPanelsCreate.mockRejectedValue(new Error('Panel creation failed'));

			await capturedOnStart!();

			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'toggleSideBarBtn',
				'toggleSideBar',
				ToolbarButtonLocation.NoteToolbar,
			);
			expect(mockToolbarButtonsCreate).toHaveBeenCalledWith(
				'toggleNoteListBtn',
				'toggleNoteList',
				ToolbarButtonLocation.NoteToolbar,
			);
		});
	});
});

describe('notion.askAI.request polling listener', () => {
	beforeEach(async () => {
		jest.clearAllMocks();
		capturedIntervalCallback = null;
		mockPanelsCreate.mockResolvedValue('panel-handle-test');
		// re-run onStart to register the interval fresh
		await capturedOnStart!();
	});

	it('registers a setInterval during onStart', () => {
		expect(setInterval).toHaveBeenCalledTimes(1);
	});

	it('calls executeWithSelection when notion.askAI.request has valid payload', async () => {
		const payload = JSON.stringify({
			text: 'selected text',
			prompt: 'make it shorter',
			isSelection: true,
			ts: 1000,
		});
		mockSettingsGlobalValue.mockResolvedValueOnce(payload);

		await capturedIntervalCallback!();

		expect(mockExecuteWithSelection).toHaveBeenCalledWith('selected text', 'make it shorter');
	});

	it('ignores payload with duplicate ts', async () => {
		const payload = JSON.stringify({ text: 'text', prompt: 'improve', ts: 1000 });
		mockSettingsGlobalValue.mockResolvedValue(payload);

		await capturedIntervalCallback!();
		mockExecuteWithSelection.mockClear();
		await capturedIntervalCallback!();

		expect(mockExecuteWithSelection).not.toHaveBeenCalled();
	});

	it('ignores payload with empty text', async () => {
		const payload = JSON.stringify({ text: '', prompt: 'improve', ts: 2000 });
		mockSettingsGlobalValue.mockResolvedValueOnce(payload);

		await capturedIntervalCallback!();

		expect(mockExecuteWithSelection).not.toHaveBeenCalled();
	});

	it('ignores payload with empty prompt', async () => {
		const payload = JSON.stringify({ text: 'hello', prompt: '', ts: 3000 });
		mockSettingsGlobalValue.mockResolvedValueOnce(payload);

		await capturedIntervalCallback!();

		expect(mockExecuteWithSelection).not.toHaveBeenCalled();
	});

	it('ignores empty setting value', async () => {
		mockSettingsGlobalValue.mockResolvedValueOnce('');

		await capturedIntervalCallback!();

		expect(mockExecuteWithSelection).not.toHaveBeenCalled();
	});
});
