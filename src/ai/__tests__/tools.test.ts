import { getOpenAITools, getClaudeTools, getPerplexityTools } from '../tools';

jest.mock('../../actions/registry', () => ({
	getActionHandlers: jest.fn(() => [
		{ name: 'create_note', description: 'Create note', parameters: {} },
		{ name: 'get_note', description: 'Get note', parameters: {} },
		{ name: 'open_note', description: 'Open note', parameters: {} },
		{ name: 'update_note', description: 'Update note', parameters: {} },
		{ name: 'delete_note', description: 'Delete note', parameters: {} },
		{ name: 'move_note', description: 'Move note', parameters: {} },
		{ name: 'search_notes', description: 'Search notes', parameters: {} },
		{ name: 'list_notebooks', description: 'List notebooks', parameters: {} },
		{ name: 'create_notebook', description: 'Create notebook', parameters: {} },
		{ name: 'add_tag', description: 'Add tag', parameters: {} },
		{ name: 'remove_tag', description: 'Remove tag', parameters: {} },
		{ name: 'list_tags', description: 'List tags', parameters: {} },
		{ name: 'web_search', description: 'Web search', parameters: {} },
	]),
	READ_ONLY_ACTIONS: new Set([
		'get_note',
		'open_note',
		'search_notes',
		'list_notebooks',
		'list_tags',
		'web_search',
	]),
	EDIT_ACTIONS: new Set(['update_note']),
}));

describe('getOpenAITools with work mode', () => {
	describe('ask mode', () => {
		it('returns only read-only tools', () => {
			const tools = getOpenAITools('ask');
			const names = tools.map((t) => t.function.name);
			expect(names).toContain('get_note');
			expect(names).toContain('open_note');
			expect(names).toContain('search_notes');
			expect(names).toContain('list_notebooks');
			expect(names).toContain('list_tags');
			expect(names).toContain('web_search');
		});

		it('excludes mutating tools', () => {
			const tools = getOpenAITools('ask');
			const names = tools.map((t) => t.function.name);
			expect(names).not.toContain('create_note');
			expect(names).not.toContain('update_note');
			expect(names).not.toContain('delete_note');
			expect(names).not.toContain('move_note');
			expect(names).not.toContain('create_notebook');
			expect(names).not.toContain('add_tag');
			expect(names).not.toContain('remove_tag');
		});
	});

	describe('edit mode', () => {
		it('returns only update_note tool', () => {
			const tools = getOpenAITools('edit');
			const names = tools.map((t) => t.function.name);
			expect(names).toEqual(['update_note']);
		});
	});

	describe('agent mode', () => {
		it('returns all tools', () => {
			const tools = getOpenAITools('agent');
			expect(tools).toHaveLength(13);
		});
	});

	describe('no mode (default)', () => {
		it('returns all tools', () => {
			const tools = getOpenAITools();
			expect(tools).toHaveLength(13);
		});
	});
});

describe('getPerplexityTools with work mode', () => {
	describe('flat tool format', () => {
		it('returns tools in flat format (not nested under function key)', () => {
			const tools = getPerplexityTools('agent');
			expect(tools[0]).toHaveProperty('type', 'function');
			expect(tools[0]).toHaveProperty('name');
			expect(tools[0]).toHaveProperty('description');
			expect(tools[0]).toHaveProperty('parameters');
			expect(tools[0]).not.toHaveProperty('function');
		});
	});

	describe('ask mode', () => {
		it('returns only read-only tools', () => {
			const tools = getPerplexityTools('ask');
			const names = tools.map((t) => t.name);
			expect(names).toContain('get_note');
			expect(names).toContain('search_notes');
			expect(names).not.toContain('create_note');
			expect(names).not.toContain('update_note');
		});
	});

	describe('edit mode', () => {
		it('returns only update_note tool', () => {
			const tools = getPerplexityTools('edit');
			const names = tools.map((t) => t.name);
			expect(names).toEqual(['update_note']);
		});
	});

	describe('agent mode', () => {
		it('returns all tools', () => {
			const tools = getPerplexityTools('agent');
			expect(tools).toHaveLength(13);
		});
	});
});

describe('getClaudeTools with work mode', () => {
	describe('ask mode', () => {
		it('returns only read-only tools', () => {
			const tools = getClaudeTools('ask');
			const names = tools.map((t) => t.name);
			expect(names).toContain('get_note');
			expect(names).toContain('open_note');
			expect(names).toContain('search_notes');
			expect(names).toContain('list_notebooks');
			expect(names).toContain('list_tags');
			expect(names).toContain('web_search');
			expect(names).not.toContain('create_note');
			expect(names).not.toContain('update_note');
			expect(names).not.toContain('delete_note');
		});
	});

	describe('edit mode', () => {
		it('returns only update_note tool', () => {
			const tools = getClaudeTools('edit');
			const names = tools.map((t) => t.name);
			expect(names).toEqual(['update_note']);
		});
	});

	describe('agent mode', () => {
		it('returns all tools', () => {
			const tools = getClaudeTools('agent');
			expect(tools).toHaveLength(13);
		});
	});
});
