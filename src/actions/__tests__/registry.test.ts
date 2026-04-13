const mockDataGet = jest.fn();
const mockDataPost = jest.fn();
const mockDataPut = jest.fn();
const mockDataDelete = jest.fn();
const mockCommandsExecute = jest.fn();

jest.mock('api', () => ({
	__esModule: true,
	default: {
		data: {
			get: (...args: unknown[]) => mockDataGet(...args),
			post: (...args: unknown[]) => mockDataPost(...args),
			put: (...args: unknown[]) => mockDataPut(...args),
			delete: (...args: unknown[]) => mockDataDelete(...args),
		},
		commands: {
			execute: (...args: unknown[]) => mockCommandsExecute(...args),
		},
	},
}));

import { executeAction, getActionHandlers } from '../registry';
import { ActionContext } from '../types';

const ctx: ActionContext = { currentNoteId: 'note-1', currentNoteTitle: 'My Note' };
const emptyCtx: ActionContext = { currentNoteId: null, currentNoteTitle: null };

beforeEach(() => jest.clearAllMocks());

describe('update_note parameter descriptions', () => {
	it('title parameter explicitly says it is for renaming the note, not editing content', () => {
		const handler = getActionHandlers().find((h) => h.name === 'update_note')!;
		const titleDesc = (handler.parameters as { properties: { title: { description: string } } })
			.properties.title.description;
		expect(titleDesc).toMatch(/rename|note.?name|notes.?list/i);
	});

	it('body parameter says it is the full text content of the note', () => {
		const handler = getActionHandlers().find((h) => h.name === 'update_note')!;
		const bodyDesc = (handler.parameters as { properties: { body: { description: string } } })
			.properties.body.description;
		expect(bodyDesc).toMatch(/content|text/i);
	});
});

describe('getActionHandlers', () => {
	it('returns all registered handlers', () => {
		const handlers = getActionHandlers();
		const names = handlers.map((h) => h.name);
		expect(names).toEqual([
			'create_note',
			'get_note',
			'open_note',
			'update_note',
			'delete_note',
			'move_note',
			'search_notes',
			'list_notebooks',
			'create_notebook',
			'add_tag',
			'remove_tag',
			'list_tags',
			'web_search',
			'generate_image',
			'remove_resource',
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

describe('open_note', () => {
	it('opens a note in Joplin by ID', async () => {
		mockDataGet.mockResolvedValue({ id: 'n1', title: 'Opened Note' });
		mockCommandsExecute.mockResolvedValue(undefined);
		const result = await executeAction('open_note', { noteId: 'n1' }, ctx);
		expect(mockCommandsExecute).toHaveBeenCalledWith('openNote', 'n1');
		expect(result.success).toBe(true);
		expect(result.message).toContain('Opened Note');
		expect(result.data?.id).toBe('n1');
	});

	it('opens the currently selected note when no noteId given', async () => {
		mockDataGet.mockResolvedValue({ id: 'note-1', title: 'My Note' });
		mockCommandsExecute.mockResolvedValue(undefined);
		const result = await executeAction('open_note', {}, ctx);
		expect(mockCommandsExecute).toHaveBeenCalledWith('openNote', 'note-1');
		expect(result.success).toBe(true);
	});

	it('fails when no noteId and no note selected', async () => {
		const result = await executeAction('open_note', {}, emptyCtx);
		expect(result.success).toBe(false);
		expect(mockCommandsExecute).not.toHaveBeenCalled();
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
		const result = await executeAction('update_note', { title: 'T', body: 'B' }, ctx);
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			title: 'T',
			body: 'B',
		});
		expect(result.success).toBe(true);
		expect(result.message).toContain('title');
		expect(result.message).toContain('body');
	});

	it('returns data with note ID and title on success', async () => {
		mockDataPut.mockResolvedValue(undefined);
		const result = await executeAction('update_note', { body: '# Updated' }, ctx);
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ id: 'note-1', title: 'My Note' });
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

	it('updates a specific note by explicit noteId', async () => {
		mockDataGet.mockResolvedValue({ id: 'other-note', title: 'Other Note' });
		mockDataPut.mockResolvedValue(undefined);
		const result = await executeAction(
			'update_note',
			{ noteId: 'other-note', body: '# Updated other' },
			ctx,
		);
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'other-note'], null, {
			body: '# Updated other',
		});
		expect(result.success).toBe(true);
		expect(result.data?.id).toBe('other-note');
		expect(result.data?.title).toBe('Other Note');
	});

	it('falls back to current note when noteId is not provided', async () => {
		mockDataPut.mockResolvedValue(undefined);
		const result = await executeAction('update_note', { body: 'fallback body' }, ctx);
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			body: 'fallback body',
		});
		expect(result.success).toBe(true);
		expect(result.data?.id).toBe('note-1');
	});

	it('fails when no noteId provided and no note selected', async () => {
		const result = await executeAction('update_note', { body: 'x' }, emptyCtx);
		expect(result.success).toBe(false);
		expect(mockDataPut).not.toHaveBeenCalled();
	});

	describe('edit mode', () => {
		const editCtx: ActionContext = {
			currentNoteId: 'note-1',
			currentNoteTitle: 'My Note',
			workMode: 'edit',
		};

		it('updates body when only body is provided in edit mode', async () => {
			mockDataPut.mockResolvedValue(undefined);
			const result = await executeAction('update_note', { body: '# Edit mode body' }, editCtx);
			expect(result.success).toBe(true);
			expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
				body: '# Edit mode body',
			});
		});

		it('updates only body when both title and body are provided in edit mode', async () => {
			mockDataPut.mockResolvedValue(undefined);
			const result = await executeAction(
				'update_note',
				{ title: 'New Title', body: '# Updated' },
				editCtx,
			);
			expect(result.success).toBe(true);
			expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, { body: '# Updated' });
		});

		it('returns clear title-protected error when only title is provided in edit mode', async () => {
			const result = await executeAction('update_note', { title: 'New Title' }, editCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/title.*read-only|read-only.*title/i);
			expect(mockDataPut).not.toHaveBeenCalled();
		});
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

	it('returns data with note ID and title on success', async () => {
		mockDataGet.mockResolvedValue({ title: 'Movable' });
		mockDataPut.mockResolvedValue(undefined);
		const result = await executeAction('move_note', { targetNotebookId: 'folder-2' }, ctx);
		expect(result.data).toEqual(expect.objectContaining({ noteId: 'note-1', title: 'Movable' }));
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
		await executeAction('create_notebook', { title: 'Sub', parentId: 'parent-1' }, ctx);
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

	it('returns data with noteId and tag name on success', async () => {
		mockDataGet.mockResolvedValue({ items: [{ id: 'tag-1', title: 'review' }] });
		mockDataPost.mockResolvedValue(undefined);
		const result = await executeAction('add_tag', { tag: 'Review' }, ctx);
		expect(result.data).toEqual({ noteId: 'note-1', tag: 'review' });
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
		const result = await executeAction('remove_tag', { tag: 'temp', noteId: 'n99' }, ctx);
		expect(mockDataDelete).toHaveBeenCalledWith(['tags', 'tag-x', 'notes', 'n99']);
		expect(result.success).toBe(true);
	});

	it('returns data with noteId and tag name on success', async () => {
		mockDataGet.mockResolvedValue({
			items: [{ id: 'tag-rm', title: 'obsolete' }],
		});
		mockDataDelete.mockResolvedValue(undefined);
		const result = await executeAction('remove_tag', { tag: 'Obsolete' }, ctx);
		expect(result.data).toEqual({ noteId: 'note-1', tag: 'obsolete' });
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

jest.mock('../../ai/web-search', () => ({
	performWebSearch: jest.fn(),
}));

jest.mock('../../ai/perplexity', () => ({
	performPerplexityWebSearch: jest.fn(),
}));

import { performWebSearch } from '../../ai/web-search';
import { performPerplexityWebSearch } from '../../ai/perplexity';

const mockedPerformWebSearch = performWebSearch as jest.MockedFunction<typeof performWebSearch>;
const mockedPerplexityWebSearch = performPerplexityWebSearch as jest.MockedFunction<
	typeof performPerplexityWebSearch
>;

describe('web_search', () => {
	beforeEach(() => {
		mockedPerformWebSearch.mockReset();
		mockedPerplexityWebSearch.mockReset();
	});

	const openaiWebCtx: ActionContext = {
		currentNoteId: 'note-1',
		currentNoteTitle: 'My Note',
		webSearchEnabled: true,
		webSearchModel: 'openai:gpt-4o-search-preview',
		openaiApiKey: 'sk-test-key',
	};

	describe('OpenAI web search model', () => {
		it('routes to OpenAI performWebSearch when webSearchModel is openai:*', async () => {
			mockedPerformWebSearch.mockResolvedValue({
				content: 'AI is evolving rapidly.',
				citations: [{ url: 'https://example.com/ai', title: 'AI News' }],
			});
			const result = await executeAction('web_search', { query: 'latest AI news' }, openaiWebCtx);
			expect(mockedPerformWebSearch).toHaveBeenCalledWith('sk-test-key', 'latest AI news');
			expect(mockedPerplexityWebSearch).not.toHaveBeenCalled();
			expect(result.success).toBe(true);
			expect(result.data?.content).toBe('AI is evolving rapidly.');
			expect(result.data?.citations).toEqual([{ url: 'https://example.com/ai', title: 'AI News' }]);
			expect(result.data?.searchProvider).toBe('openai');
			expect(result.data?.searchModel).toBe('gpt-4o-search-preview');
		});

		it('defaults to OpenAI when webSearchModel is not set', async () => {
			mockedPerformWebSearch.mockResolvedValue({ content: 'result', citations: [] });
			const ctxNoModel: ActionContext = {
				currentNoteId: 'note-1',
				currentNoteTitle: 'My Note',
				webSearchEnabled: true,
				openaiApiKey: 'sk-test-key',
			};
			const result = await executeAction('web_search', { query: 'test' }, ctxNoModel);
			expect(mockedPerformWebSearch).toHaveBeenCalled();
			expect(result.success).toBe(true);
		});

		it('fails when OpenAI API key is missing', async () => {
			const noKeyCtx: ActionContext = {
				currentNoteId: 'note-1',
				currentNoteTitle: 'My Note',
				webSearchEnabled: true,
				webSearchModel: 'openai:gpt-4o-search-preview',
			};
			const result = await executeAction('web_search', { query: 'test' }, noKeyCtx);
			expect(result.success).toBe(false);
			expect(result.message).toContain('OpenAI API key');
			expect(mockedPerformWebSearch).not.toHaveBeenCalled();
		});

		it('returns failure when OpenAI search throws', async () => {
			mockedPerformWebSearch.mockRejectedValue(new Error('Rate limit exceeded'));
			const result = await executeAction('web_search', { query: 'test' }, openaiWebCtx);
			expect(result.success).toBe(false);
			expect(result.message).toContain('Rate limit exceeded');
		});

		it('handles empty citations', async () => {
			mockedPerformWebSearch.mockResolvedValue({ content: 'No sources.', citations: [] });
			const result = await executeAction('web_search', { query: 'obscure topic' }, openaiWebCtx);
			expect(result.success).toBe(true);
			expect(result.data?.citations).toEqual([]);
		});
	});

	describe('Perplexity web search model', () => {
		const perplexityWebCtx: ActionContext = {
			currentNoteId: 'note-1',
			currentNoteTitle: 'My Note',
			webSearchEnabled: true,
			webSearchModel: 'perplexity:sonar-pro',
			perplexityApiKey: 'pplx-test-key',
		};

		it('routes to Perplexity when webSearchModel is perplexity:*', async () => {
			mockedPerplexityWebSearch.mockResolvedValue({
				content: 'Perplexity search result.',
				citations: [{ url: 'https://source.com', title: 'Source' }],
			});
			const result = await executeAction('web_search', { query: 'latest news' }, perplexityWebCtx);
			expect(mockedPerplexityWebSearch).toHaveBeenCalledWith(
				'pplx-test-key',
				'sonar-pro',
				'latest news',
			);
			expect(mockedPerformWebSearch).not.toHaveBeenCalled();
			expect(result.success).toBe(true);
			expect(result.data?.content).toBe('Perplexity search result.');
			expect(result.data?.citations).toEqual([{ url: 'https://source.com', title: 'Source' }]);
			expect(result.data?.searchProvider).toBe('perplexity');
			expect(result.data?.searchModel).toBe('sonar-pro');
		});

		it('routes to correct model when webSearchModel is perplexity:sonar-reasoning-pro', async () => {
			mockedPerplexityWebSearch.mockResolvedValue({ content: 'reasoned result', citations: [] });
			const ctx: ActionContext = {
				...perplexityWebCtx,
				webSearchModel: 'perplexity:sonar-reasoning-pro',
			};
			await executeAction('web_search', { query: 'test' }, ctx);
			expect(mockedPerplexityWebSearch).toHaveBeenCalledWith(
				'pplx-test-key',
				'sonar-reasoning-pro',
				'test',
			);
		});

		it('fails when Perplexity API key is missing', async () => {
			const noKeyCtx: ActionContext = {
				currentNoteId: 'note-1',
				currentNoteTitle: 'My Note',
				webSearchEnabled: true,
				webSearchModel: 'perplexity:sonar-pro',
			};
			const result = await executeAction('web_search', { query: 'test' }, noKeyCtx);
			expect(result.success).toBe(false);
			expect(result.message).toContain('Perplexity API key');
			expect(mockedPerplexityWebSearch).not.toHaveBeenCalled();
		});

		it('returns failure when Perplexity search throws', async () => {
			mockedPerplexityWebSearch.mockRejectedValue(new Error('Perplexity rate limit'));
			const result = await executeAction('web_search', { query: 'test' }, perplexityWebCtx);
			expect(result.success).toBe(false);
			expect(result.message).toContain('Perplexity rate limit');
		});
	});

	describe('web search disabled', () => {
		it('fails when web search is not enabled', async () => {
			const noSearchCtx: ActionContext = {
				currentNoteId: 'note-1',
				currentNoteTitle: 'My Note',
				webSearchEnabled: false,
				openaiApiKey: 'sk-test',
			};
			const result = await executeAction('web_search', { query: 'test' }, noSearchCtx);
			expect(result.success).toBe(false);
			expect(result.message).toContain('not available');
			expect(mockedPerformWebSearch).not.toHaveBeenCalled();
			expect(mockedPerplexityWebSearch).not.toHaveBeenCalled();
		});
	});
});

describe('EDIT_ACTIONS set', () => {
	it('contains read-only actions plus update_note', async () => {
		const { EDIT_ACTIONS, READ_ONLY_ACTIONS } = await import('../registry');
		for (const action of READ_ONLY_ACTIONS) {
			expect(EDIT_ACTIONS.has(action)).toBe(true);
		}
		expect(EDIT_ACTIONS.has('update_note')).toBe(true);
	});

	it('does not contain destructive actions', async () => {
		const { EDIT_ACTIONS } = await import('../registry');
		expect(EDIT_ACTIONS.has('create_note')).toBe(false);
		expect(EDIT_ACTIONS.has('delete_note')).toBe(false);
		expect(EDIT_ACTIONS.has('move_note')).toBe(false);
		expect(EDIT_ACTIONS.has('create_notebook')).toBe(false);
		expect(EDIT_ACTIONS.has('add_tag')).toBe(false);
		expect(EDIT_ACTIONS.has('remove_tag')).toBe(false);
		expect(EDIT_ACTIONS.has('generate_image')).toBe(false);
		expect(EDIT_ACTIONS.has('remove_resource')).toBe(false);
	});
});

describe('executeAction — work mode enforcement', () => {
	const askCtx: ActionContext = {
		currentNoteId: 'note-1',
		currentNoteTitle: 'My Note',
		workMode: 'ask',
	};
	const editCtx: ActionContext = {
		currentNoteId: 'note-1',
		currentNoteTitle: 'My Note',
		workMode: 'edit',
	};
	const agentCtx: ActionContext = {
		currentNoteId: 'note-1',
		currentNoteTitle: 'My Note',
		workMode: 'agent',
	};

	describe('ask mode', () => {
		it('blocks update_note and returns failure with mode switch hint', async () => {
			const result = await executeAction('update_note', { body: '# New body' }, askCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/ask mode/i);
			expect(result.message).toMatch(/agent|edit/i);
			expect(mockDataPut).not.toHaveBeenCalled();
		});

		it('blocks create_note', async () => {
			const result = await executeAction('create_note', { title: 'T', body: 'B' }, askCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/ask mode/i);
			expect(mockDataPost).not.toHaveBeenCalled();
		});

		it('blocks delete_note', async () => {
			const result = await executeAction('delete_note', { noteId: 'n1' }, askCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/ask mode/i);
			expect(mockDataDelete).not.toHaveBeenCalled();
		});

		it('blocks move_note', async () => {
			const result = await executeAction('move_note', { targetNotebookId: 'f1' }, askCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/ask mode/i);
		});

		it('blocks create_notebook', async () => {
			const result = await executeAction('create_notebook', { title: 'NB' }, askCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/ask mode/i);
		});

		it('blocks add_tag', async () => {
			const result = await executeAction('add_tag', { tag: 'test' }, askCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/ask mode/i);
		});

		it('blocks remove_tag', async () => {
			const result = await executeAction('remove_tag', { tag: 'test' }, askCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/ask mode/i);
		});

		it('blocks generate_image', async () => {
			const result = await executeAction(
				'generate_image',
				{ prompt: 'a cat' },
				{ ...askCtx, kieApiKey: 'kie-key' },
			);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/ask mode/i);
		});

		it('allows get_note', async () => {
			mockDataGet.mockResolvedValue({
				id: 'n1',
				title: 'Found',
				body: 'content',
				parent_id: 'f1',
			});
			const result = await executeAction('get_note', { noteId: 'n1' }, askCtx);
			expect(result.success).toBe(true);
		});

		it('allows search_notes', async () => {
			mockDataGet.mockResolvedValue({ items: [] });
			const result = await executeAction('search_notes', { query: 'test' }, askCtx);
			expect(result.success).toBe(true);
		});

		it('allows list_notebooks', async () => {
			mockDataGet.mockResolvedValue({ items: [] });
			const result = await executeAction('list_notebooks', {}, askCtx);
			expect(result.success).toBe(true);
		});

		it('allows list_tags', async () => {
			mockDataGet.mockResolvedValue({ items: [] });
			const result = await executeAction('list_tags', {}, askCtx);
			expect(result.success).toBe(true);
		});

		it('allows open_note', async () => {
			mockDataGet.mockResolvedValue({ id: 'note-1', title: 'My Note' });
			mockCommandsExecute.mockResolvedValue(undefined);
			const result = await executeAction('open_note', { noteId: 'note-1' }, askCtx);
			expect(result.success).toBe(true);
		});
	});

	describe('edit mode', () => {
		it('allows update_note', async () => {
			mockDataPut.mockResolvedValue(undefined);
			const result = await executeAction('update_note', { body: '# New' }, editCtx);
			expect(result.success).toBe(true);
		});

		it('strips title from update_note args so the LLM cannot rename the note', async () => {
			mockDataPut.mockResolvedValue(undefined);
			await executeAction('update_note', { title: 'New Title', body: '# Fixed' }, editCtx);
			expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, { body: '# Fixed' });
		});

		it('succeeds with body-only update when LLM passes both title and body in edit mode', async () => {
			mockDataPut.mockResolvedValue(undefined);
			const result = await executeAction(
				'update_note',
				{ title: 'Unwanted rename', body: 'Corrected body' },
				editCtx,
			);
			expect(result.success).toBe(true);
			expect(mockDataPut).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.anything(),
				expect.objectContaining({ title: 'Unwanted rename' }),
			);
		});

		it('still succeeds when LLM passes only title (strips it, nothing to update → returns no-op success)', async () => {
			mockDataPut.mockResolvedValue(undefined);
			const result = await executeAction('update_note', { title: 'Sneaky Rename' }, editCtx);
			expect(result.success).toBe(false);
			expect(mockDataPut).not.toHaveBeenCalled();
		});

		it('blocks create_note', async () => {
			const result = await executeAction('create_note', { title: 'T', body: 'B' }, editCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/edit mode/i);
			expect(mockDataPost).not.toHaveBeenCalled();
		});

		it('blocks delete_note', async () => {
			const result = await executeAction('delete_note', { noteId: 'n1' }, editCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/edit mode/i);
		});

		it('blocks move_note', async () => {
			const result = await executeAction('move_note', { targetNotebookId: 'f1' }, editCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/edit mode/i);
		});

		it('blocks create_notebook', async () => {
			const result = await executeAction('create_notebook', { title: 'NB' }, editCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/edit mode/i);
		});

		it('blocks add_tag', async () => {
			const result = await executeAction('add_tag', { tag: 'test' }, editCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/edit mode/i);
		});

		it('blocks remove_tag', async () => {
			const result = await executeAction('remove_tag', { tag: 'test' }, editCtx);
			expect(result.success).toBe(false);
			expect(result.message).toMatch(/edit mode/i);
		});

		it('allows search_notes (read-only access permitted)', async () => {
			mockDataGet.mockResolvedValue({ items: [] });
			const result = await executeAction('search_notes', { query: 'test' }, editCtx);
			expect(result.success).toBe(true);
		});

		it('allows get_note (read-only access permitted)', async () => {
			mockDataGet.mockResolvedValue({ id: 'n1', title: 'Found', body: 'content', parent_id: 'f1' });
			const result = await executeAction('get_note', { noteId: 'n1' }, editCtx);
			expect(result.success).toBe(true);
		});

		it('allows open_note (read-only access permitted)', async () => {
			mockDataGet.mockResolvedValue({ id: 'note-1', title: 'My Note' });
			mockCommandsExecute.mockResolvedValue(undefined);
			const result = await executeAction('open_note', { noteId: 'note-1' }, editCtx);
			expect(result.success).toBe(true);
		});

		it('allows list_notebooks (read-only access permitted)', async () => {
			mockDataGet.mockResolvedValue({ items: [] });
			const result = await executeAction('list_notebooks', {}, editCtx);
			expect(result.success).toBe(true);
		});

		it('allows list_tags (read-only access permitted)', async () => {
			mockDataGet.mockResolvedValue({ items: [] });
			const result = await executeAction('list_tags', {}, editCtx);
			expect(result.success).toBe(true);
		});
	});

	describe('agent mode', () => {
		it('allows update_note', async () => {
			mockDataPut.mockResolvedValue(undefined);
			const result = await executeAction('update_note', { body: '# New' }, agentCtx);
			expect(result.success).toBe(true);
		});

		it('allows create_note', async () => {
			mockDataPost.mockResolvedValue({ id: 'new-1', title: 'Test' });
			const result = await executeAction('create_note', { title: 'Test', body: 'B' }, agentCtx);
			expect(result.success).toBe(true);
		});

		it('allows delete_note', async () => {
			mockDataGet.mockResolvedValue({ id: 'n1', title: 'Note' });
			mockDataDelete.mockResolvedValue(undefined);
			const result = await executeAction('delete_note', { noteId: 'n1' }, agentCtx);
			expect(result.success).toBe(true);
		});
	});

	describe('no mode (undefined)', () => {
		it('allows all actions (backward compatible)', async () => {
			mockDataPost.mockResolvedValue({ id: 'new-1', title: 'Test' });
			const result = await executeAction('create_note', { title: 'Test', body: 'B' }, ctx);
			expect(result.success).toBe(true);
		});
	});
});

jest.mock('../../ai/image-gen', () => ({
	generateImage: jest.fn(),
	downloadImageToFile: jest.fn(),
}));

import { generateImage, downloadImageToFile } from '../../ai/image-gen';

const mockedGenerateImage = generateImage as jest.MockedFunction<typeof generateImage>;
const mockedDownloadImageToFile = downloadImageToFile as jest.MockedFunction<
	typeof downloadImageToFile
>;

jest.mock('fs');
import * as fs from 'fs';
const mockedFsUnlink = fs.unlinkSync as jest.MockedFunction<typeof fs.unlinkSync>;

describe('generate_image', () => {
	beforeEach(() => {
		mockedGenerateImage.mockReset();
		mockedDownloadImageToFile.mockReset();
		mockedFsUnlink.mockImplementation(() => undefined);
	});

	const imageCtx: ActionContext = {
		currentNoteId: 'note-1',
		currentNoteTitle: 'My Note',
		kieApiKey: 'kie-test-key',
		imageGenModel: 'gpt-image/1.5-text-to-image',
	};

	it('generates an image, creates a resource attachment, and inserts resource reference into note', async () => {
		mockedGenerateImage.mockResolvedValue({
			taskId: 'task_img1',
			imageUrls: ['https://cdn.kie.ai/result.png'],
		});
		mockedDownloadImageToFile.mockResolvedValue({
			filePath: '/tmp/joplin-img-abc/result.png',
			filename: 'result.png',
			mimeType: 'image/png',
		});
		mockDataPost.mockResolvedValue({ id: 'resource-id-123', title: 'result.png' });
		mockDataGet.mockResolvedValue({ body: '# Existing content' });
		mockDataPut.mockResolvedValue(undefined);

		const result = await executeAction(
			'generate_image',
			{ prompt: 'A sunset over mountains' },
			imageCtx,
		);

		expect(mockedGenerateImage).toHaveBeenCalledWith(
			'kie-test-key',
			expect.objectContaining({
				prompt: 'A sunset over mountains',
				model: 'gpt-image/1.5-text-to-image',
			}),
			expect.objectContaining({ intervalMs: 3000, maxAttempts: 60 }),
		);
		expect(mockedDownloadImageToFile).toHaveBeenCalledWith('https://cdn.kie.ai/result.png');
		expect(mockDataPost).toHaveBeenCalledWith(
			['resources'],
			null,
			{ title: 'result.png', mime: 'image/png' },
			[{ path: '/tmp/joplin-img-abc/result.png' }],
		);
		expect(result.success).toBe(true);
		expect(result.data?.resourceId).toBe('resource-id-123');
		expect(result.data?.noteId).toBe('note-1');
		expect(mockDataPut).toHaveBeenCalledWith(
			['notes', 'note-1'],
			null,
			expect.objectContaining({
				body: expect.stringContaining('![A sunset over mountains](:/resource-id-123)'),
			}),
		);
	});

	it('cleans up temp file after creating resource', async () => {
		mockedGenerateImage.mockResolvedValue({
			taskId: 'task_cleanup',
			imageUrls: ['https://cdn.kie.ai/cleanup.png'],
		});
		mockedDownloadImageToFile.mockResolvedValue({
			filePath: '/tmp/joplin-img-xyz/cleanup.png',
			filename: 'cleanup.png',
			mimeType: 'image/png',
		});
		mockDataPost.mockResolvedValue({ id: 'res-cleanup', title: 'cleanup.png' });
		mockDataGet.mockResolvedValue({ body: '' });
		mockDataPut.mockResolvedValue(undefined);

		await executeAction('generate_image', { prompt: 'test cleanup' }, imageCtx);

		expect(mockedFsUnlink).toHaveBeenCalledWith('/tmp/joplin-img-xyz/cleanup.png');
	});

	it('cleans up temp file even when resource creation fails', async () => {
		mockedGenerateImage.mockResolvedValue({
			taskId: 'task_fail_cleanup',
			imageUrls: ['https://cdn.kie.ai/fail.png'],
		});
		mockedDownloadImageToFile.mockResolvedValue({
			filePath: '/tmp/joplin-img-fail/fail.png',
			filename: 'fail.png',
			mimeType: 'image/png',
		});
		mockDataPost.mockRejectedValue(new Error('Resource creation failed'));

		const result = await executeAction('generate_image', { prompt: 'test' }, imageCtx);

		expect(result.success).toBe(false);
		expect(mockedFsUnlink).toHaveBeenCalledWith('/tmp/joplin-img-fail/fail.png');
	});

	it('passes aspect ratio, quality, and style to generateImage', async () => {
		mockedGenerateImage.mockResolvedValue({
			taskId: 'task_styled',
			imageUrls: ['https://cdn.kie.ai/styled.png'],
		});
		mockedDownloadImageToFile.mockResolvedValue({
			filePath: '/tmp/joplin-img-s/styled.png',
			filename: 'styled.png',
			mimeType: 'image/png',
		});
		mockDataPost.mockResolvedValue({ id: 'res-styled', title: 'styled.png' });
		mockDataGet.mockResolvedValue({ body: '' });
		mockDataPut.mockResolvedValue(undefined);

		await executeAction(
			'generate_image',
			{
				prompt: 'A dragon',
				aspectRatio: '3:2',
				quality: 'high',
				style: 'watercolor',
			},
			imageCtx,
		);

		expect(mockedGenerateImage).toHaveBeenCalledWith(
			'kie-test-key',
			expect.objectContaining({
				aspectRatio: '3:2',
				quality: 'high',
				style: 'watercolor',
			}),
			expect.any(Object),
		);
	});

	it('uses explicit noteId when provided', async () => {
		mockedGenerateImage.mockResolvedValue({
			taskId: 'task_note',
			imageUrls: ['https://cdn.kie.ai/img.png'],
		});
		mockedDownloadImageToFile.mockResolvedValue({
			filePath: '/tmp/joplin-img-n/img.png',
			filename: 'img.png',
			mimeType: 'image/png',
		});
		mockDataPost.mockResolvedValue({ id: 'res-other', title: 'img.png' });
		mockDataGet.mockResolvedValue({ body: 'Other note' });
		mockDataPut.mockResolvedValue(undefined);

		const result = await executeAction(
			'generate_image',
			{ prompt: 'A tree', noteId: 'other-note-id' },
			imageCtx,
		);

		expect(result.success).toBe(true);
		expect(result.data?.noteId).toBe('other-note-id');
		expect(mockDataGet).toHaveBeenCalledWith(['notes', 'other-note-id'], { fields: ['body'] });
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'other-note-id'], null, expect.any(Object));
	});

	it('fails when Kie.ai API key is not configured', async () => {
		const noKeyCtx: ActionContext = {
			currentNoteId: 'note-1',
			currentNoteTitle: 'My Note',
		};

		const result = await executeAction('generate_image', { prompt: 'test' }, noKeyCtx);

		expect(result.success).toBe(false);
		expect(result.message).toContain('Kie.ai API key');
		expect(mockedGenerateImage).not.toHaveBeenCalled();
	});

	it('fails when no note is selected and no noteId given', async () => {
		const noNoteCtx: ActionContext = {
			currentNoteId: null,
			currentNoteTitle: null,
			kieApiKey: 'kie-key',
		};

		const result = await executeAction('generate_image', { prompt: 'test' }, noNoteCtx);

		expect(result.success).toBe(false);
		expect(result.message).toContain('No note ID');
		expect(mockedGenerateImage).not.toHaveBeenCalled();
	});

	it('returns failure when image generation throws', async () => {
		mockedGenerateImage.mockRejectedValue(new Error('Insufficient Credits'));

		const result = await executeAction('generate_image', { prompt: 'test' }, imageCtx);

		expect(result.success).toBe(false);
		expect(result.message).toContain('Insufficient Credits');
	});

	it('uses configured model from context', async () => {
		const ctx4o: ActionContext = {
			...imageCtx,
			imageGenModel: 'gpt4o-image',
		};
		mockedGenerateImage.mockResolvedValue({
			taskId: 'task_4o',
			imageUrls: ['https://cdn.kie.ai/4o.png'],
		});
		mockedDownloadImageToFile.mockResolvedValue({
			filePath: '/tmp/joplin-img-4o/4o.png',
			filename: '4o.png',
			mimeType: 'image/png',
		});
		mockDataPost.mockResolvedValue({ id: 'res-4o', title: '4o.png' });
		mockDataGet.mockResolvedValue({ body: '' });
		mockDataPut.mockResolvedValue(undefined);

		await executeAction('generate_image', { prompt: 'A cat' }, ctx4o);

		expect(mockedGenerateImage).toHaveBeenCalledWith(
			'kie-test-key',
			expect.objectContaining({ model: 'gpt4o-image' }),
			expect.any(Object),
		);
	});

	it('returns failure when download throws', async () => {
		mockedGenerateImage.mockResolvedValue({
			taskId: 'task_dl_fail',
			imageUrls: ['https://cdn.kie.ai/broken.png'],
		});
		mockedDownloadImageToFile.mockRejectedValue(new Error('Download failed: HTTP 404'));

		const result = await executeAction('generate_image', { prompt: 'test' }, imageCtx);

		expect(result.success).toBe(false);
		expect(result.message).toContain('Download failed');
	});

	it('appends resource reference to existing note body', async () => {
		mockedGenerateImage.mockResolvedValue({
			taskId: 'task_append',
			imageUrls: ['https://cdn.kie.ai/appended.png'],
		});
		mockedDownloadImageToFile.mockResolvedValue({
			filePath: '/tmp/joplin-img-a/appended.png',
			filename: 'appended.png',
			mimeType: 'image/png',
		});
		mockDataPost.mockResolvedValue({ id: 'res-append', title: 'appended.png' });
		mockDataGet.mockResolvedValue({ body: '# My Note\n\nSome content here.' });
		mockDataPut.mockResolvedValue(undefined);

		await executeAction('generate_image', { prompt: 'A flower' }, imageCtx);

		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			body: '# My Note\n\nSome content here.\n\n![A flower](:/res-append)',
		});
	});
});

describe('remove_resource', () => {
	it('removes resource reference from note body and deletes the resource', async () => {
		mockDataGet.mockResolvedValue({
			body: '# My Note\n\n![cat photo](:/abc123def456)\n\nSome text after.',
		});
		mockDataPut.mockResolvedValue(undefined);
		mockDataDelete.mockResolvedValue(undefined);

		const result = await executeAction('remove_resource', { resourceId: 'abc123def456' }, ctx);

		expect(result.success).toBe(true);
		expect(mockDataGet).toHaveBeenCalledWith(['notes', 'note-1'], { fields: ['body'] });
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			body: '# My Note\n\nSome text after.',
		});
		expect(mockDataDelete).toHaveBeenCalledWith(['resources', 'abc123def456']);
	});

	it('uses explicit noteId when provided', async () => {
		mockDataGet.mockResolvedValue({
			body: '![img](:/res999)\n\nContent',
		});
		mockDataPut.mockResolvedValue(undefined);
		mockDataDelete.mockResolvedValue(undefined);

		const result = await executeAction(
			'remove_resource',
			{ noteId: 'other-note', resourceId: 'res999' },
			ctx,
		);

		expect(result.success).toBe(true);
		expect(mockDataGet).toHaveBeenCalledWith(['notes', 'other-note'], { fields: ['body'] });
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'other-note'], null, {
			body: 'Content',
		});
	});

	it('falls back to current note when noteId is not provided', async () => {
		mockDataGet.mockResolvedValue({ body: '![pic](:/resabc)' });
		mockDataPut.mockResolvedValue(undefined);
		mockDataDelete.mockResolvedValue(undefined);

		await executeAction('remove_resource', { resourceId: 'resabc' }, ctx);

		expect(mockDataGet).toHaveBeenCalledWith(['notes', 'note-1'], { fields: ['body'] });
	});

	it('fails when no note selected and no noteId provided', async () => {
		const result = await executeAction('remove_resource', { resourceId: 'x' }, emptyCtx);

		expect(result.success).toBe(false);
		expect(result.message).toContain('No note ID');
		expect(mockDataGet).not.toHaveBeenCalled();
	});

	it('fails when resourceId is not provided', async () => {
		const result = await executeAction('remove_resource', {}, ctx);

		expect(result.success).toBe(false);
		expect(result.message).toContain('resource ID');
	});

	it('removes only the specified resource when note has multiple images', async () => {
		mockDataGet.mockResolvedValue({
			body: '# Gallery\n\n![cat](:/res111)\n\n![dog](:/res222)\n\n![bird](:/res333)',
		});
		mockDataPut.mockResolvedValue(undefined);
		mockDataDelete.mockResolvedValue(undefined);

		const result = await executeAction('remove_resource', { resourceId: 'res222' }, ctx);

		expect(result.success).toBe(true);
		expect(mockDataPut).toHaveBeenCalledWith(['notes', 'note-1'], null, {
			body: '# Gallery\n\n![cat](:/res111)\n\n![bird](:/res333)',
		});
		expect(mockDataDelete).toHaveBeenCalledWith(['resources', 'res222']);
	});

	it('still deletes resource even if reference not found in body', async () => {
		mockDataGet.mockResolvedValue({
			body: '# No images here',
		});
		mockDataDelete.mockResolvedValue(undefined);

		const result = await executeAction('remove_resource', { resourceId: 'orphaned123' }, ctx);

		expect(result.success).toBe(true);
		expect(mockDataDelete).toHaveBeenCalledWith(['resources', 'orphaned123']);
		expect(mockDataPut).not.toHaveBeenCalled();
	});

	it('cleans up empty lines left after removing image reference', async () => {
		mockDataGet.mockResolvedValue({
			body: 'Before\n\n![removed](:/resrm)\n\nAfter',
		});
		mockDataPut.mockResolvedValue(undefined);
		mockDataDelete.mockResolvedValue(undefined);

		const result = await executeAction('remove_resource', { resourceId: 'resrm' }, ctx);

		expect(result.success).toBe(true);
		const updatedBody = mockDataPut.mock.calls[0][2].body as string;
		expect(updatedBody).not.toMatch(/\n{3,}/);
		expect(updatedBody).toContain('Before');
		expect(updatedBody).toContain('After');
	});

	it('handles resource delete failure gracefully', async () => {
		mockDataGet.mockResolvedValue({
			body: '![pic](:/res404)\n\nText',
		});
		mockDataPut.mockResolvedValue(undefined);
		mockDataDelete.mockRejectedValue(new Error('Resource not found'));

		const result = await executeAction('remove_resource', { resourceId: 'res404' }, ctx);

		expect(result.success).toBe(true);
		expect(result.message).toContain('removed from note');
	});

	it('returns data with noteId and resourceId on success', async () => {
		mockDataGet.mockResolvedValue({ body: '![x](:/resdata)' });
		mockDataPut.mockResolvedValue(undefined);
		mockDataDelete.mockResolvedValue(undefined);

		const result = await executeAction('remove_resource', { resourceId: 'resdata' }, ctx);

		expect(result.data).toEqual({ noteId: 'note-1', resourceId: 'resdata' });
	});
});
