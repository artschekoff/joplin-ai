/**
 * @jest-environment jsdom
 *
 * Tests for panel.js after separation — verifies that panel.js (AI chat)
 * no longer handles or dispatches block-editor related messages.
 *
 * After separation, blockEditorState, showAiChat, and noteLoaded messages
 * are NOT handled by panel.js because the block editor is in a separate panel.
 */

import * as fs from 'fs';
import * as path from 'path';

const panelSource = fs.readFileSync(path.resolve(__dirname, '..', 'panel.js'), 'utf-8');

const buildDOM = (): void => {
	document.body.innerHTML = `
    <div id="app">
      <div class="ai-chat-pane">
        <div class="header">
          <div class="header-title"></div>
          <div class="note-info" id="noteInfo"></div>
          <div class="role-bar" id="roleBar">
            <select id="roleSelect"><option value="">No role</option></select>
            <button id="applyRoleBtn"></button>
            <button id="manageRolesBtn"></button>
          </div>
        </div>
        <div class="messages" id="messages">
          <div class="empty-state" id="emptyState"></div>
        </div>
        <div id="queueContainer" class="queue-container"></div>
        <div class="input-area">
          <div class="input-container">
            <div id="fileChips" class="file-chips"></div>
            <div class="textarea-wrap">
              <textarea id="promptInput" rows="2"></textarea>
            </div>
            <div class="bottom-bar">
              <div class="bottom-bar-left">
                <div class="mode-pill-wrap">
                  <select id="modeSelect">
                    <option value="ask">Ask</option>
                    <option value="agent" selected>Agent</option>
                    <option value="edit">Edit</option>
                  </select>
                </div>
                <button id="attachFileBtn"></button>
                <button id="clearBtn"></button>
              </div>
              <div class="bottom-bar-right">
                <div id="contextSizeContainer"></div>
                <button id="clearHistoryBtn"></button>
                <button id="executeBtn"></button>
              </div>
            </div>
          </div>
          <input type="file" id="fileInput" style="display:none" />
        </div>
        <div id="roleManageView" style="display: none;"></div>
      </div>
    </div>
  `;
};

let capturedOnMessageHandler: ((event: { message: unknown }) => void) | null = null;

const setupGlobals = (): void => {
	(window as any).renderMarkdown = undefined;
	(window as any).webviewApi = {
		postMessage: jest.fn(),
		onMessage: jest.fn().mockImplementation((handler: (e: { message: unknown }) => void) => {
			capturedOnMessageHandler = handler;
		}),
	};
};

const cleanupGlobals = (): void => {
	delete (window as any).renderMarkdown;
	delete (window as any).webviewApi;
	delete (window as any).__lastNoteLoaded;
};

beforeEach(() => {
	jest.clearAllMocks();
	capturedOnMessageHandler = null;
	localStorage.clear();
	buildDOM();
	setupGlobals();
	eval(panelSource);
});

afterEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	cleanupGlobals();
});

const sendMessage = (msg: unknown): void => {
	capturedOnMessageHandler?.({ message: msg });
};

describe('panel.js after separation — no block editor coupling', () => {
	it('does NOT dispatch ai:enableEditor on blockEditorState active:true', () => {
		const spy = jest.fn();
		window.addEventListener('ai:enableEditor', spy);
		sendMessage({ type: 'blockEditorState', active: true });
		window.removeEventListener('ai:enableEditor', spy);
		expect(spy).not.toHaveBeenCalled();
	});

	it('does NOT dispatch ai:disableEditor on blockEditorState active:false', () => {
		const spy = jest.fn();
		window.addEventListener('ai:disableEditor', spy);
		sendMessage({ type: 'blockEditorState', active: false });
		window.removeEventListener('ai:disableEditor', spy);
		expect(spy).not.toHaveBeenCalled();
	});

	it('does NOT dispatch ai:noteLoaded on noteLoaded message', () => {
		const spy = jest.fn();
		window.addEventListener('ai:noteLoaded', spy);
		sendMessage({
			type: 'noteLoaded',
			note: { id: 'note-1', title: 'Test Note', body: '# Hello' },
			blockEditorActive: true,
		});
		window.removeEventListener('ai:noteLoaded', spy);
		expect(spy).not.toHaveBeenCalled();
	});

	it('does NOT set window.__lastNoteLoaded', () => {
		sendMessage({
			type: 'noteLoaded',
			note: { id: '1', title: 'T', body: 'B' },
			blockEditorActive: true,
		});
		expect((window as any).__lastNoteLoaded).toBeUndefined();
	});

	it('still handles noteInfo messages normally', () => {
		const noteInfoEl = document.getElementById('noteInfo');
		sendMessage({ type: 'noteInfo', title: 'My Note', noteId: 'n1' });
		expect(noteInfoEl?.textContent).toContain('My Note');
	});
});
