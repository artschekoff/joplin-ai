/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

const markdownJsSource = fs.readFileSync(path.resolve(__dirname, '..', 'markdown.js'), 'utf-8');
const iconsJsSource = fs.readFileSync(path.resolve(__dirname, '..', 'icons.js'), 'utf-8');
const panelJsSource = fs.readFileSync(path.resolve(__dirname, '..', 'panel.js'), 'utf-8');

const buildDOM = (): void => {
	document.body.innerHTML = `
		<div id="app">
			<div class="header">
				<div class="header-title">
					AI Assistant
					<button id="settingsBtn" class="icon-btn header-settings-btn" title="AI Settings"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg></button>
				</div>
				<div id="noteInfo" class="note-info"></div>
				<div class="role-bar" id="roleBar">
					<select id="roleSelect" class="role-select">
						<option value="">No role</option>
					</select>
					<button id="applyRoleBtn" class="btn btn-sm">Apply</button>
					<button id="manageRolesBtn" class="btn btn-sm">Roles</button>
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
						<textarea id="promptInput"></textarea>
					</div>
					<div class="bottom-bar">
						<div class="bottom-bar-left">
							<div class="mode-pill-wrap">
								<select id="modeSelect" class="mode-pill-select">
									<option value="ask">Ask</option>
									<option value="agent" selected>Agent</option>
									<option value="edit">Edit</option>
								</select>
							</div>
							<button id="attachFileBtn" class="icon-btn"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="m21.44 11.05-9.19 9.19"/></svg></button>
							<button id="clearBtn" class="icon-btn"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/></svg></button>
						</div>
						<div class="bottom-bar-right">
							<div id="contextSizeContainer" class="context-size-container"></div>
							<button id="clearHistoryBtn" class="icon-btn"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/></svg></button>
							<button id="executeBtn" class="btn send-btn"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/></svg></button>
						</div>
					</div>
				</div>
				<input type="file" id="fileInput" style="display:none" multiple />
			</div>
			<div id="roleManageView" class="role-manage-view" style="display: none;"></div>
			<div id="settingsManageView" class="settings-manage-view" style="display: none;"></div>
		</div>
	`;
};

const createMockWebviewApi = () => ({
	postMessage: jest.fn(),
	onMessage: jest.fn(),
});

const initPanel = (mockApi: ReturnType<typeof createMockWebviewApi>): void => {
	(window as any).webviewApi = mockApi;
	eval(markdownJsSource);
	eval(iconsJsSource);
	eval(panelJsSource);
	document.dispatchEvent(new Event('DOMContentLoaded'));
};

/** single-change edit — 1 change group */
const makePendingEdit = (overrides: Record<string, unknown> = {}) => ({
	noteId: 'note-123',
	noteTitle: 'Test Note',
	oldBody: 'line1\nold line\nline3',
	newBody: 'line1\nnew line\nline3',
	...overrides,
});

/** two-change edit — 2 change groups */
const makeTwoGroupEdit = (overrides: Record<string, unknown> = {}) => ({
	noteId: 'note-123',
	noteTitle: 'Test Note',
	oldBody: 'line1\nline2\nline3\nline4\nline5',
	newBody: 'line1\nNEW2\nline3\nNEW4\nline5',
	...overrides,
});

const getApplyCalls = (mockApi: ReturnType<typeof createMockWebviewApi>) =>
	mockApi.postMessage.mock.calls.filter(
		(c: unknown[]) => (c[0] as Record<string, unknown>).type === 'applyEdit',
	);

beforeEach(() => {
	localStorage.clear();
});

describe('diff review — rendering', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let messageHandler: (msg: unknown) => void;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		messageHandler = mockApi.onMessage.mock.calls[0][0];
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('renders a diff-review block when result has pendingEdits', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit()] });
		expect(document.querySelector('.diff-review')).not.toBeNull();
	});

	it('does not render diff-review when pendingEdits is absent', () => {
		messageHandler({ type: 'result', content: 'Updated.', isEdit: true, actions: [] });
		expect(document.querySelector('.diff-review')).toBeNull();
	});

	it('shows removed lines with diff-line-removed class', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit()] });
		const lines = document.querySelectorAll('.diff-line-removed');
		expect(lines.length).toBeGreaterThan(0);
		expect(lines[0].textContent).toContain('old line');
	});

	it('shows added lines with diff-line-added class', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit()] });
		const lines = document.querySelectorAll('.diff-line-added');
		expect(lines.length).toBeGreaterThan(0);
		expect(lines[0].textContent).toContain('new line');
	});

	it('displays note title in diff-review header', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit({ noteTitle: 'My Special Note' })] });
		expect((document.querySelector('.diff-review') as HTMLElement).textContent).toContain('My Special Note');
	});

	it('renders separate group cards for a two-change edit', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makeTwoGroupEdit()] });
		const groups = document.querySelectorAll('.diff-group');
		expect(groups.length).toBe(2);
	});

	it('each group card has data-group-id attribute', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makeTwoGroupEdit()] });
		const groups = document.querySelectorAll('.diff-group');
		groups.forEach((g) => expect(g.getAttribute('data-group-id')).toBeTruthy());
	});

	it('each group card has Accept and Reject buttons', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makeTwoGroupEdit()] });
		const accepts = document.querySelectorAll('.diff-review-accept');
		const rejects = document.querySelectorAll('.diff-review-cancel');
		expect(accepts.length).toBe(2);
		expect(rejects.length).toBe(2);
	});

	it('shows Accept All and Reject All buttons', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit()] });
		expect(document.querySelector('.diff-review-accept-all')).not.toBeNull();
		expect(document.querySelector('.diff-review-cancel-all')).not.toBeNull();
	});

	it('diff-review-body has inline min-height to prevent collapse', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit()] });
		const body = document.querySelector('.diff-review-body') as HTMLElement;
		expect(body).not.toBeNull();
		expect(body.style.minHeight || body.getAttribute('data-has-min-height')).toBeTruthy();
	});

	it('calls scrollIntoView on the first diff block', () => {
		const mock = jest.fn();
		HTMLElement.prototype.scrollIntoView = mock;
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit()] });
		expect(mock).toHaveBeenCalled();
		delete (HTMLElement.prototype as any).scrollIntoView;
	});
});

describe('diff review — single-group accept/reject', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let messageHandler: (msg: unknown) => void;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		messageHandler = mockApi.onMessage.mock.calls[0][0];
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('sends applyEdit with newBody when the only group is accepted', () => {
		const edit = makePendingEdit();
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [edit] });

		(document.querySelector('.diff-review-accept') as HTMLButtonElement).click();

		const calls = getApplyCalls(mockApi);
		expect(calls).toHaveLength(1);
		expect((calls[0][0] as Record<string, unknown>).noteId).toBe('note-123');
		expect((calls[0][0] as Record<string, unknown>).body).toBe(edit.newBody);
	});

	it('does NOT send applyEdit when the only group is rejected', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit()] });

		(document.querySelector('.diff-review-cancel') as HTMLButtonElement).click();

		expect(getApplyCalls(mockApi)).toHaveLength(0);
	});

	it('removes diff-review block after Accept', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit()] });
		(document.querySelector('.diff-review-accept') as HTMLButtonElement).click();
		expect(document.querySelector('.diff-review')).toBeNull();
	});

	it('removes diff-review block after Reject', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit()] });
		(document.querySelector('.diff-review-cancel') as HTMLButtonElement).click();
		expect(document.querySelector('.diff-review')).toBeNull();
	});
});

describe('diff review — multi-group per-group decisions', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let messageHandler: (msg: unknown) => void;
	const twoGroupEdit = makeTwoGroupEdit();

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		messageHandler = mockApi.onMessage.mock.calls[0][0];
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('does not send applyEdit after deciding only one group of two', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [twoGroupEdit] });
		(document.querySelectorAll('.diff-review-accept')[0] as HTMLButtonElement).click();
		expect(getApplyCalls(mockApi)).toHaveLength(0);
	});

	it('sends applyEdit with newBody when both groups accepted', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [twoGroupEdit] });
		document.querySelectorAll('.diff-review-accept').forEach((b) => (b as HTMLButtonElement).click());

		const calls = getApplyCalls(mockApi);
		expect(calls).toHaveLength(1);
		expect((calls[0][0] as Record<string, unknown>).body).toBe(twoGroupEdit.newBody);
	});

	it('does NOT send applyEdit when both groups rejected', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [twoGroupEdit] });
		document.querySelectorAll('.diff-review-cancel').forEach((b) => (b as HTMLButtonElement).click());
		expect(getApplyCalls(mockApi)).toHaveLength(0);
	});

	it('sends applyEdit with partial body: accept first group, reject second', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [twoGroupEdit] });
		const accepts = document.querySelectorAll('.diff-review-accept');
		const rejects = document.querySelectorAll('.diff-review-cancel');
		(accepts[0] as HTMLButtonElement).click(); // accept group 0
		(rejects[1] as HTMLButtonElement).click(); // reject group 1

		const calls = getApplyCalls(mockApi);
		expect(calls).toHaveLength(1);
		expect((calls[0][0] as Record<string, unknown>).body).toBe('line1\nNEW2\nline3\nline4\nline5');
	});

	it('sends applyEdit with partial body: reject first group, accept second', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [twoGroupEdit] });
		const accepts = document.querySelectorAll('.diff-review-accept');
		const rejects = document.querySelectorAll('.diff-review-cancel');
		(rejects[0] as HTMLButtonElement).click(); // reject group 0
		(accepts[1] as HTMLButtonElement).click(); // accept group 1

		const calls = getApplyCalls(mockApi);
		expect(calls).toHaveLength(1);
		expect((calls[0][0] as Record<string, unknown>).body).toBe('line1\nline2\nline3\nNEW4\nline5');
	});

	it('removes diff-review block after all groups decided', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [twoGroupEdit] });
		document.querySelectorAll('.diff-review-accept').forEach((b) => (b as HTMLButtonElement).click());
		expect(document.querySelector('.diff-review')).toBeNull();
	});
});

describe('diff review — Accept All / Reject All', () => {
	let mockApi: ReturnType<typeof createMockWebviewApi>;
	let messageHandler: (msg: unknown) => void;

	beforeEach(() => {
		buildDOM();
		mockApi = createMockWebviewApi();
		initPanel(mockApi);
		messageHandler = mockApi.onMessage.mock.calls[0][0];
	});

	afterEach(() => {
		delete (window as any).webviewApi;
	});

	it('Accept All sends applyEdit with newBody for each pendingEdit', () => {
		const edits = [makePendingEdit(), makePendingEdit({ noteId: 'note-456', oldBody: 'x', newBody: 'y' })];
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: edits });

		(document.querySelector('.diff-review-accept-all') as HTMLButtonElement).click();

		const calls = getApplyCalls(mockApi);
		expect(calls).toHaveLength(2);
		expect((calls[0][0] as Record<string, unknown>).body).toBe(edits[0].newBody);
		expect((calls[1][0] as Record<string, unknown>).body).toBe(edits[1].newBody);
	});

	it('Reject All sends NO applyEdit messages', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit(), makePendingEdit({ noteId: 'note-456' })] });

		(document.querySelector('.diff-review-cancel-all') as HTMLButtonElement).click();

		expect(getApplyCalls(mockApi)).toHaveLength(0);
	});

	it('Accept All removes all diff-review blocks', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit(), makePendingEdit({ noteId: 'note-456' })] });
		(document.querySelector('.diff-review-accept-all') as HTMLButtonElement).click();
		expect(document.querySelectorAll('.diff-review')).toHaveLength(0);
	});

	it('Reject All removes all diff-review blocks', () => {
		messageHandler({ type: 'result', content: 'Done', isEdit: true, actions: [], pendingEdits: [makePendingEdit(), makePendingEdit({ noteId: 'note-456' })] });
		(document.querySelector('.diff-review-cancel-all') as HTMLButtonElement).click();
		expect(document.querySelectorAll('.diff-review')).toHaveLength(0);
	});
});

// CRLF / whitespace normalization is handled at the AI boundary (sanitizeContent in service.ts),
// not in the diff viewer — tests for that belong in service.test.ts
