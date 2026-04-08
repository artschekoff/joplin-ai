const mockDataGet = jest.fn();
const mockDataPost = jest.fn();
const mockDataPut = jest.fn();
const mockDataDelete = jest.fn();

jest.mock('api', () => ({
	__esModule: true,
	default: {
		data: {
			get: (...args: unknown[]) => mockDataGet(...args),
			post: (...args: unknown[]) => mockDataPost(...args),
			put: (...args: unknown[]) => mockDataPut(...args),
			delete: (...args: unknown[]) => mockDataDelete(...args),
		},
	},
}));

import { executeAction, getActionHandlers } from '../registry';
import { ActionContext } from '../types';

const ctx: ActionContext = { currentNoteId: 'note-1', currentNoteTitle: 'My Note' };
const emptyCtx: ActionContext = { currentNoteId: null, currentNoteTitle: null };

beforeEach(() => jest.clearAllMocks());

describe('getActionHandlers', () => {
	it('returns all registered handlers', () => {
		const handlers = getActionHandlers();
		const names = handlers.map((h) => h.name);
		expect(names).toEqual([
			'create_note',
			'get_note',
			'update_note',
			'delete_note',
			'move_note',
			'search_notes',
			'list_notebooks',
			'create_notebook',
			'add_tag',
			'remove_tag',
			'list_tags',
		]);
	});

	it('every handler has name, description, parameters, and execute', () => {
		for (const h of getActionHandlers()) {
			expect(h.name).toBeTruthy();
			expect(h.description).toBeTruthy();
			expect(h.parameters).toBeDefined();
			expect(typeof h.execute).toBe('function');
		}
	});
});

describe('executeAction — unknown action', () => {
	it('returns failure for unknown action name', async () => {
		const result = await executeAction('nonexistent', {}, ctx);
		expect(result.success).toBe(false);
		expect(result.message).toContain('Unknown action');
	});
});

describe('create_note', () => {
	it('creates a note with title and body', async () => {
		mockDataPost.mockResolvedValue({ id: 'new-1', title: 'Test' });
		const result = await executeAction('create_note', { title: 'Test', body: '# Hi' }, ctx);
		expect(mockDataPost).toHaveBeenCalledWith(['notes'], null, {
			title: 'Test',
			body: '# Hi',
			parent_id: undefined,
		});
		expect(result.success).toBe(true);
		expect(result.data?.id).toBe('new-1');
	});

	it('creates a note in a specific notebook', async () => {
		mockDataPost.mockResolvedValue({ id: 'new-2', title: 'In folder' });
		await executeAction(
			'create_note',
			{ title: 'In folder', body: 'body', parentId: 'folder-1' },
			ctx,
		);
		expect(mockDataPost).toHaveBeenCalledWith(['notes'], null, {
			title: 'In folder',
			body: 'body',
			parent_id: 'folder-1',
		});
	});
});

describe('get_note', () => {
	it('reads a note by ID', async () => {
		mockDataGet.mockResolvedValue({
			id: 'n1',
			title: 'Found',
			body: 'content',
			parent_id: 'f1',
		});
		const result = await executeAction('get_note', { noteId: 'n1' }, ctx);
		expect(mockDataGet).toHaveBeenCalledWith(['notes', 'n1'], {
			fields: ['id', 'title', 'body', 'parent_id'],
		});
		expect(result.success).toBe(true);
		expect(result.data?.body).toBe('content');
	});

	it('fails when note is not found', async () => {
		mockDataGet.mockResolvedValue(null);
		const result = await executeAction('get_note', { noteId: 'missing' }, ctx);
		expect(result.success).toBe(false);
	});
});

describe('update_note', () => {
	it('updates body of current note', async () => {
		mockDataPut.mockResolvedValue(undefined);
		const result = await executeAction('update_note', { body: '# New body' }, ctx);
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			body: '# New body',
		});
		expect(result.success).toBe(true);
	});

	it('updates title of current note', async () => {
		mockDataPut.mockResolvedValue(undefined);
		const result = await executeAction('update_note', { title: 'New Title' }, ctx);
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			title: 'New Title',
		});
		expect(result.success).toBe(true);
	});

	it('updates both title and body', async () => {
		mockDataPut.mockResolvedValue(undefined);
		const result = await executeAction(
			'update_note',
			{ title: 'T', body: 'B' },
			ctx,
		);
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			title: 'T',
			body: 'B',
		});
		expect(result.success).toBe(true);
		expect(result.message).toContain('title');
		expect(result.message).toContain('body');
	});

	it('fails when no note is selected', async () => {
		const result = await executeAction('update_note', { body: 'x' }, emptyCtx);
		expect(result.success).toBe(false);
		expect(mockDataPut).not.toHaveBeenCalled();
	});

	it('fails when no fields provided', async () => {
		const result = await executeAction('update_note', {}, ctx);
		expect(result.success).toBe(false);
		expect(result.message).toContain('No fields');
	});
});

describe('delete_note', () => {
	it('deletes a note by explicit ID', async () => {
		mockDataGet.mockResolvedValue({ id: 'del-1', title: 'Doomed' });
		mockDataDelete.mockResolvedValue(undefined);
		const result = await executeAction('delete_note', { noteId: 'del-1' }, ctx);
		expect(mockDataDelete).toHaveBeenCalledWith(['notes', 'del-1']);
		expect(result.success).toBe(true);
		expect(result.data?.title).toBe('Doomed');
	});

	it('deletes the currently selected note when no noteId given', async () => {
		mockDataGet.mockResolvedValue({ id: 'note-1', title: 'My Note' });
		mockDataDelete.mockResolvedValue(undefined);
		const result = await executeAction('delete_note', {}, ctx);
		expect(mockDataDelete).toHaveBeenCalledWith(['notes', 'note-1']);
		expect(result.success).toBe(true);
	});

	it('fails when no note ID and no note selected', async () => {
		const result = await executeAction('delete_note', {}, emptyCtx);
		expect(result.success).toBe(false);
		expect(mockDataDelete).not.toHaveBeenCalled();
	});
});

describe('move_note', () => {
	it('moves the current note to a new notebook', async () => {
		mockDataGet.mockResolvedValue({ title: 'Movable' });
		mockDataPut.mockResolvedValue(undefined);
		const result = await executeAction('move_note', { targetNotebookId: 'folder-2' }, ctx);
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			parent_id: 'folder-2',
		});
		expect(result.success).toBe(true);
	});

	it('moves a specific note by ID', async () => {
		mockDataGet.mockResolvedValue({ title: 'Other' });
		mockDataPut.mockResolvedValue(undefined);
		const result = await executeAction(
			'move_note',
			{ noteId: 'other-1', targetNotebookId: 'folder-3' },
			ctx,
		);
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'other-1'], null, {
			parent_id: 'folder-3',
		});
		expect(result.success).toBe(true);
	});

	it('fails when no note and no selection', async () => {
		const result = await executeAction('move_note', { targetNotebookId: 'f' }, emptyCtx);
		expect(result.success).toBe(false);
	});
});

describe('search_notes', () => {
	it('searches with query and default limit', async () => {
		mockDataGet.mockResolvedValue({
			items: [{ id: 's1', title: 'Result 1', parent_id: 'f1' }],
		});
		const result = await executeAction('search_notes', { query: 'typescript' }, ctx);
		expect(mockDataGet).toHaveBeenCalledWith(['search'], {
			query: 'typescript',
			fields: ['id', 'title', 'parent_id'],
			limit: 10,
		});
		expect(result.success).toBe(true);
		expect((result.data?.notes as unknown[]).length).toBe(1);
	});

	it('respects custom limit', async () => {
		mockDataGet.mockResolvedValue({ items: [] });
		await executeAction('search_notes', { query: 'test', limit: 5 }, ctx);
		expect(mockDataGet).toHaveBeenCalledWith(['search'], expect.objectContaining({ limit: 5 }));
	});

	it('handles empty results', async () => {
		mockDataGet.mockResolvedValue({ items: [] });
		const result = await executeAction('search_notes', { query: 'nothing' }, ctx);
		expect(result.success).toBe(true);
		expect(result.message).toContain('0 note(s)');
	});
});

describe('list_notebooks', () => {
	it('lists all notebooks', async () => {
		mockDataGet.mockResolvedValue({
			items: [
				{ id: 'f1', title: 'Work', parent_id: '' },
				{ id: 'f2', title: 'Personal', parent_id: '' },
			],
		});
		const result = await executeAction('list_notebooks', {}, ctx);
		expect(mockDataGet).toHaveBeenCalledWith(['folders'], {
			fields: ['id', 'title', 'parent_id'],
		});
		expect(result.success).toBe(true);
		expect((result.data?.notebooks as unknown[]).length).toBe(2);
	});
});

describe('create_notebook', () => {
	it('creates a top-level notebook', async () => {
		mockDataPost.mockResolvedValue({ id: 'nf1', title: 'Archive' });
		const result = await executeAction('create_notebook', { title: 'Archive' }, ctx);
		expect(mockDataPost).toHaveBeenCalledWith(['folders'], null, {
			title: 'Archive',
			parent_id: undefined,
		});
		expect(result.success).toBe(true);
		expect(result.data?.id).toBe('nf1');
	});

	it('creates a nested notebook', async () => {
		mockDataPost.mockResolvedValue({ id: 'nf2', title: 'Sub' });
		await executeAction(
			'create_notebook',
			{ title: 'Sub', parentId: 'parent-1' },
			ctx,
		);
		expect(mockDataPost).toHaveBeenCalledWith(['folders'], null, {
			title: 'Sub',
			parent_id: 'parent-1',
		});
	});
});

describe('add_tag', () => {
	it('creates a new tag and links it to the current note', async () => {
		mockDataGet.mockResolvedValue({ items: [] });
		mockDataPost
			.mockResolvedValueOnce({ id: 'tag-new', title: 'review' })
			.mockResolvedValueOnce(undefined);
		const result = await executeAction('add_tag', { tag: 'Review' }, ctx);
		expect(mockDataPost).toHaveBeenCalledWith(['tags'], null, { title: 'review' });
		expect(mockDataPost).toHaveBeenCalledWith(['tags', 'tag-new', 'notes'], null, {
			id: 'note-1',
		});
		expect(result.success).toBe(true);
	});

	it('reuses existing tag', async () => {
		mockDataGet.mockResolvedValue({
			items: [{ id: 'tag-exist', title: 'important' }],
		});
		mockDataPost.mockResolvedValue(undefined);
		const result = await executeAction('add_tag', { tag: 'Important' }, ctx);
		expect(mockDataPost).toHaveBeenCalledTimes(1);
		expect(mockDataPost).toHaveBeenCalledWith(['tags', 'tag-exist', 'notes'], null, {
			id: 'note-1',
		});
		expect(result.success).toBe(true);
	});

	it('tags a specific note by noteId', async () => {
		mockDataGet.mockResolvedValue({ items: [{ id: 't1', title: 'done' }] });
		mockDataPost.mockResolvedValue(undefined);
		const result = await executeAction('add_tag', { tag: 'done', noteId: 'other-n' }, ctx);
		expect(mockDataPost).toHaveBeenCalledWith(['tags', 't1', 'notes'], null, {
			id: 'other-n',
		});
		expect(result.success).toBe(true);
	});

	it('fails when no note selected and no noteId', async () => {
		const result = await executeAction('add_tag', { tag: 'x' }, emptyCtx);
		expect(result.success).toBe(false);
	});
});

describe('remove_tag', () => {
	it('removes an existing tag from the current note', async () => {
		mockDataGet.mockResolvedValue({
			items: [{ id: 'tag-rm', title: 'obsolete' }],
		});
		mockDataDelete.mockResolvedValue(undefined);
		const result = await executeAction('remove_tag', { tag: 'Obsolete' }, ctx);
		expect(mockDataDelete).toHaveBeenCalledWith(['tags', 'tag-rm', 'notes', 'note-1']);
		expect(result.success).toBe(true);
	});

	it('fails when tag does not exist', async () => {
		mockDataGet.mockResolvedValue({ items: [] });
		const result = await executeAction('remove_tag', { tag: 'ghost' }, ctx);
		expect(result.success).toBe(false);
		expect(result.message).toContain('not found');
	});

	it('removes tag from a specific note by noteId', async () => {
		mockDataGet.mockResolvedValue({
			items: [{ id: 'tag-x', title: 'temp' }],
		});
		mockDataDelete.mockResolvedValue(undefined);
		const result = await executeAction(
			'remove_tag',
			{ tag: 'temp', noteId: 'n99' },
			ctx,
		);
		expect(mockDataDelete).toHaveBeenCalledWith(['tags', 'tag-x', 'notes', 'n99']);
		expect(result.success).toBe(true);
	});

	it('fails when no note selected and no noteId', async () => {
		const result = await executeAction('remove_tag', { tag: 'x' }, emptyCtx);
		expect(result.success).toBe(false);
	});
});

describe('list_tags', () => {
	it('lists all tags when no noteId given', async () => {
		mockDataGet.mockResolvedValue({
			items: [
				{ id: 't1', title: 'work' },
				{ id: 't2', title: 'personal' },
			],
		});
		const result = await executeAction('list_tags', {}, ctx);
		expect(mockDataGet).toHaveBeenCalledWith(['tags'], { fields: ['id', 'title'] });
		expect(result.success).toBe(true);
		expect((result.data?.tags as unknown[]).length).toBe(2);
	});

	it('lists tags for a specific note', async () => {
		mockDataGet.mockResolvedValue({ items: [{ id: 't3', title: 'draft' }] });
		const result = await executeAction('list_tags', { noteId: 'n5' }, ctx);
		expect(mockDataGet).toHaveBeenCalledWith(['notes', 'n5', 'tags'], {
			fields: ['id', 'title'],
		});
		expect(result.success).toBe(true);
	});
});
