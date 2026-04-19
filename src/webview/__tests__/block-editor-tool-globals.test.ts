/**
 * @jest-environment jsdom
 *
 * Regression test for Editor.js init crash when tool globals are undefined.
 *
 * Root cause: initEditorJs() checks only `typeof window.EditorJS === 'undefined'`
 * but passes tool class globals (window.Header, window.EditorjsList, etc.)
 * directly to EditorJS config without verifying they exist. When any tool class
 * is `undefined`, EditorJS crashes with:
 *   "TypeError: Cannot read properties of undefined (reading 'name')"
 * at BlockManager.composeBlock.
 *
 * Additionally, the crash prevents the built-in Paragraph tool from registering,
 * which produces the secondary warning:
 *   "Tool «paragraph» is not found."
 *
 * Fix requirements:
 *  1. When one or more tool globals are undefined, initEditorJs() must still
 *     succeed — undefined tools are filtered out of the config.
 *  2. The `tools` config passed to `new EditorJS()` must never include an
 *     entry where `class` is undefined.
 *  3. When ALL tool globals are undefined but EditorJS itself is present,
 *     the editor should still initialise with zero external tools.
 *  4. The boot retry should also check tool globals, not just EditorJS.
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

const TOOL_GLOBALS = [
	'Header',
	'EditorjsList',
	'Checklist',
	'CodeTool',
	'Quote',
	'Delimiter',
] as const;

const registerAllGlobals = (mockEditorJsCtor: jest.Mock): void => {
	(window as any).EditorJS = mockEditorJsCtor;
	(window as any).DragDrop = jest.fn();
	(window as any).Header = class MockHeader {
		static get toolbox() {
			return { title: 'H' };
		}
	};
	(window as any).EditorjsList = class MockList {
		static get toolbox() {
			return { title: 'L' };
		}
	};
	(window as any).Checklist = class MockChecklist {
		static get toolbox() {
			return { title: 'C' };
		}
	};
	(window as any).CodeTool = class MockCode {
		static get toolbox() {
			return { title: 'Co' };
		}
	};
	(window as any).Quote = class MockQuote {
		static get toolbox() {
			return { title: 'Q' };
		}
	};
	(window as any).Delimiter = class MockDelimiter {
		static get toolbox() {
			return { title: 'D' };
		}
	};
	(window as any).MarkdownConverter = {
		markdownToBlocks: jest.fn().mockReturnValue([]),
		blocksToMarkdown: jest.fn().mockReturnValue(''),
	};
	(window as any).webviewApi = { postMessage: jest.fn(), onMessage: jest.fn() };
};

const cleanupGlobals = (): void => {
	for (const key of [
		'BlockEditor',
		'EditorJS',
		'DragDrop',
		...TOOL_GLOBALS,
		'MarkdownConverter',
		'webviewApi',
	])
		delete (window as any)[key];
};

beforeEach(() => {
	jest.clearAllMocks();
	jest.useFakeTimers();
	window.HTMLElement.prototype.scrollIntoView = jest.fn();
	localStorage.clear();
	buildDOM();
});

afterEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	cleanupGlobals();
	jest.useRealTimers();
});

// ── 1. Partial tool globals: some undefined, EditorJS should still init ──────

describe('EditorJS init with some tool globals undefined', () => {
	it('should initialise successfully when Header global is undefined', () => {
		const mockEditor = makeMockEditor();
		const mockCtor = jest.fn().mockImplementation(({ onReady }: any) => {
			onReady?.();
			return mockEditor;
		});
		registerAllGlobals(mockCtor);
		delete (window as any).Header;

		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		// eslint-disable-next-line no-eval
		eval(blockEditorSource);
		jest.runAllTimers();

		expect(mockCtor).toHaveBeenCalledTimes(1);
		expect(errorSpy).not.toHaveBeenCalledWith(
			expect.stringContaining('[BlockEditor] EditorJS failed to load'),
		);
		errorSpy.mockRestore();
	});

	it('should initialise successfully when multiple tool globals are undefined', () => {
		const mockEditor = makeMockEditor();
		const mockCtor = jest.fn().mockImplementation(({ onReady }: any) => {
			onReady?.();
			return mockEditor;
		});
		registerAllGlobals(mockCtor);
		delete (window as any).Header;
		delete (window as any).Quote;
		delete (window as any).Delimiter;

		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		// eslint-disable-next-line no-eval
		eval(blockEditorSource);
		jest.runAllTimers();

		expect(mockCtor).toHaveBeenCalledTimes(1);
		expect(errorSpy).not.toHaveBeenCalledWith(
			expect.stringContaining('[BlockEditor] EditorJS failed to load'),
		);
		errorSpy.mockRestore();
	});
});

// ── 2. tools config must never include undefined class ───────────────────────

describe('EditorJS tools config filtering', () => {
	it('should not pass undefined class values in tools config', () => {
		const mockEditor = makeMockEditor();
		const mockCtor = jest.fn().mockImplementation(({ onReady }: any) => {
			onReady?.();
			return mockEditor;
		});
		registerAllGlobals(mockCtor);
		delete (window as any).Header;
		delete (window as any).CodeTool;

		// eslint-disable-next-line no-eval
		eval(blockEditorSource);
		jest.runAllTimers();

		expect(mockCtor).toHaveBeenCalledTimes(1);
		const config = mockCtor.mock.calls[0][0];
		const toolEntries = Object.entries(config.tools || {}) as [string, any][];

		for (const [toolName, toolDef] of toolEntries) {
			expect(toolDef.class).toBeDefined();
			expect(toolDef.class).not.toBeUndefined();
		}

		expect(config.tools.header).toBeUndefined();
		expect(config.tools.code).toBeUndefined();
	});

	it('should keep defined tool classes in the config', () => {
		const mockEditor = makeMockEditor();
		const mockCtor = jest.fn().mockImplementation(({ onReady }: any) => {
			onReady?.();
			return mockEditor;
		});
		registerAllGlobals(mockCtor);
		delete (window as any).Header;

		// eslint-disable-next-line no-eval
		eval(blockEditorSource);
		jest.runAllTimers();

		const config = mockCtor.mock.calls[0][0];

		expect(config.tools.list).toBeDefined();
		expect(config.tools.list.class).toBe((window as any).EditorjsList);
		expect(config.tools.checklist).toBeDefined();
		expect(config.tools.quote).toBeDefined();
		expect(config.tools.delimiter).toBeDefined();
	});
});

// ── 3. All tool globals undefined — EditorJS should still work ───────────────

describe('EditorJS init with ALL tool globals undefined', () => {
	it('should initialise with empty tools config when no tool globals exist', () => {
		const mockEditor = makeMockEditor();
		const mockCtor = jest.fn().mockImplementation(({ onReady }: any) => {
			onReady?.();
			return mockEditor;
		});
		registerAllGlobals(mockCtor);
		for (const key of TOOL_GLOBALS) delete (window as any)[key];

		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		// eslint-disable-next-line no-eval
		eval(blockEditorSource);
		jest.runAllTimers();

		expect(mockCtor).toHaveBeenCalledTimes(1);
		const config = mockCtor.mock.calls[0][0];
		const toolNames = Object.keys(config.tools);
		expect(toolNames).toEqual(['table', 'askAI', 'askAITune']);
		expect(errorSpy).not.toHaveBeenCalledWith(
			expect.stringContaining('[BlockEditor] EditorJS failed to load'),
		);
		errorSpy.mockRestore();
	});
});

// ── 4. Boot retry should work with late-arriving tool globals ────────────────

describe('Boot retry with late-arriving tool globals', () => {
	it('should use tool globals that arrive during the retry window', () => {
		(window as any).MarkdownConverter = {
			markdownToBlocks: jest.fn().mockReturnValue([]),
			blocksToMarkdown: jest.fn().mockReturnValue(''),
		};
		(window as any).webviewApi = { postMessage: jest.fn(), onMessage: jest.fn() };

		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

		// eslint-disable-next-line no-eval
		eval(blockEditorSource);

		const mockEditor = makeMockEditor();
		const mockCtor = jest.fn().mockImplementation(({ onReady }: any) => {
			onReady?.();
			return mockEditor;
		});
		registerAllGlobals(mockCtor);

		jest.runAllTimers();

		expect(mockCtor).toHaveBeenCalledTimes(1);
		const config = mockCtor.mock.calls[0][0];
		expect(config.tools.header).toBeDefined();
		expect(config.tools.header.class).toBeDefined();
		expect(errorSpy).not.toHaveBeenCalledWith(
			expect.stringContaining('[BlockEditor] EditorJS failed to load'),
		);
		errorSpy.mockRestore();
	});
});
