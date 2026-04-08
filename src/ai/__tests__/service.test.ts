import { buildSystemPrompt, sendToAI, validateApiKey } from '../service';

jest.mock('../openai', () => ({
	callOpenAI: jest.fn(),
	sendOpenAIMessages: jest.fn(),
}));
jest.mock('../claude', () => ({
	callClaude: jest.fn(),
	sendClaudeMessages: jest.fn(),
}));
jest.mock('../../actions/registry', () => ({
	getActionHandlers: jest.fn(() => []),
	executeAction: jest.fn(),
}));
jest.mock('../tools', () => ({
	getOpenAITools: jest.fn(() => []),
	getClaudeTools: jest.fn(() => []),
}));

import { sendOpenAIMessages } from '../openai';
import { sendClaudeMessages } from '../claude';
import { executeAction } from '../../actions/registry';

const mockedSendOpenAI = sendOpenAIMessages as jest.MockedFunction<typeof sendOpenAIMessages>;
const mockedSendClaude = sendClaudeMessages as jest.MockedFunction<typeof sendClaudeMessages>;
const mockedExecuteAction = executeAction as jest.MockedFunction<typeof executeAction>;

describe('buildSystemPrompt', () => {
	it('includes note title and body', () => {
		const prompt = buildSystemPrompt('My Note', 'Hello world');
		expect(prompt).toContain('Current note title: My Note');
		expect(prompt).toContain('Hello world');
	});

	it('lists all available tools', () => {
		const prompt = buildSystemPrompt('Test', 'Body');
		expect(prompt).toContain('create_note');
		expect(prompt).toContain('get_note');
		expect(prompt).toContain('update_note');
		expect(prompt).toContain('delete_note');
		expect(prompt).toContain('move_note');
		expect(prompt).toContain('search_notes');
		expect(prompt).toContain('list_notebooks');
		expect(prompt).toContain('create_notebook');
		expect(prompt).toContain('add_tag');
		expect(prompt).toContain('remove_tag');
		expect(prompt).toContain('list_tags');
	});

	it('truncates body longer than 30000 characters', () => {
		const longBody = 'x'.repeat(35000);
		const prompt = buildSystemPrompt('Test', longBody);
		expect(prompt).toContain('[... note truncated due to length ...]');
		expect(prompt).not.toContain('x'.repeat(35000));
	});

	it('does not truncate body at exactly 30000 characters', () => {
		const body = 'y'.repeat(30000);
		const prompt = buildSystemPrompt('Test', body);
		expect(prompt).not.toContain('[... note truncated');
		expect(prompt).toContain(body);
	});
});

describe('validateApiKey', () => {
	it('throws when API key is empty string', () => {
		expect(() => validateApiKey('openai', '')).toThrow('API key for openai is not configured');
	});

	it('throws when API key is whitespace only', () => {
		expect(() => validateApiKey('claude', '   ')).toThrow('API key for claude is not configured');
	});

	it('does not throw when API key is valid', () => {
		expect(() => validateApiKey('openai', 'sk-valid-key')).not.toThrow();
	});
});

describe('sendToAI', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('API key validation', () => {
		it('throws when API key is empty string', async () => {
			await expect(sendToAI('openai', '', 'gpt-4o', 'hello', 'Title', 'Body')).rejects.toThrow(
				'API key for openai is not configured',
			);
			expect(mockedSendOpenAI).not.toHaveBeenCalled();
		});

		it('throws when API key is whitespace only', async () => {
			await expect(
				sendToAI('claude', '   ', 'claude-sonnet-4-20250514', 'hello', 'Title', 'Body'),
			).rejects.toThrow('API key for claude is not configured');
			expect(mockedSendClaude).not.toHaveBeenCalled();
		});
	});

	it('routes to OpenAI when provider is "openai"', async () => {
		mockedSendOpenAI.mockResolvedValue({
			textContent: 'Plain answer from OpenAI',
			toolCalls: [],
			finishReason: 'stop',
			rawAssistantMessage: { content: 'Plain answer from OpenAI' },
		});

		const result = await sendToAI('openai', 'sk-test', 'gpt-4o', 'What is this?', 'Title', 'Body');

		expect(mockedSendOpenAI).toHaveBeenCalledTimes(1);
		expect(mockedSendClaude).not.toHaveBeenCalled();
		expect(result.isEdit).toBe(false);
		expect(result.content).toBe('Plain answer from OpenAI');
		expect(result.actions).toEqual([]);
	});

	it('routes to Claude when provider is "claude"', async () => {
		mockedSendClaude.mockResolvedValue({
			textContent: 'Answer from Claude',
			toolCalls: [],
			finishReason: 'end_turn',
			rawAssistantMessage: { role: 'assistant', content: [] },
		});

		const result = await sendToAI(
			'claude',
			'sk-ant-test',
			'claude-sonnet-4-20250514',
			'Explain',
			'Title',
			'Body',
		);

		expect(mockedSendClaude).toHaveBeenCalledTimes(1);
		expect(mockedSendOpenAI).not.toHaveBeenCalled();
		expect(result.isEdit).toBe(false);
		expect(result.content).toBe('Answer from Claude');
		expect(result.actions).toEqual([]);
	});

	it('passes system prompt with note context to provider', async () => {
		mockedSendOpenAI.mockResolvedValue({
			textContent: 'ok',
			toolCalls: [],
			finishReason: 'stop',
			rawAssistantMessage: { content: 'ok' },
		});

		await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'My Title', 'My Body');

		const messages = mockedSendOpenAI.mock.calls[0][2];
		const systemMessage = messages.find((m: { role: string }) => m.role === 'system') as {
			content: string;
		};
		expect(systemMessage.content).toContain('Current note title: My Title');
		expect(systemMessage.content).toContain('My Body');
	});

	it('executes tool calls and returns action outcomes', async () => {
		mockedSendOpenAI
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [
					{
						id: 'call_1',
						name: 'create_note',
						args: { title: 'New Note', body: '# Hello' },
					},
				],
				finishReason: 'tool_calls',
				rawAssistantMessage: {
					content: null,
					tool_calls: [
						{
							id: 'call_1',
							type: 'function',
							function: {
								name: 'create_note',
								arguments: '{"title":"New Note","body":"# Hello"}',
							},
						},
					],
				},
			})
			.mockResolvedValueOnce({
				textContent: 'I created a new note called "New Note".',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: {
					content: 'I created a new note called "New Note".',
				},
			});

		mockedExecuteAction.mockResolvedValue({
			success: true,
			message: 'Note "New Note" created',
			data: { id: 'note-123', title: 'New Note' },
		});

		const result = await sendToAI(
			'openai',
			'sk-test',
			'gpt-4o',
			'create a new note',
			'Title',
			'Body',
			{ currentNoteId: 'curr-1', currentNoteTitle: 'Title' },
		);

		expect(mockedExecuteAction).toHaveBeenCalledWith(
			'create_note',
			{ title: 'New Note', body: '# Hello' },
			{ currentNoteId: 'curr-1', currentNoteTitle: 'Title' },
		);
		expect(result.actions).toHaveLength(1);
		expect(result.actions[0]).toEqual({
			action: 'create_note',
			success: true,
			message: 'Note "New Note" created',
			data: { id: 'note-123', title: 'New Note' },
		});
		expect(result.content).toBe('I created a new note called "New Note".');
	});

	it('sets isEdit=true when update_note tool succeeds', async () => {
		mockedSendClaude
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [
					{
						id: 'tc_1',
						name: 'update_note',
						args: { body: '# Updated body' },
					},
				],
				finishReason: 'tool_use',
				rawAssistantMessage: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'tc_1',
							name: 'update_note',
							input: { body: '# Updated body' },
						},
					],
				},
			})
			.mockResolvedValueOnce({
				textContent: 'Done, I updated the note.',
				toolCalls: [],
				finishReason: 'end_turn',
				rawAssistantMessage: { role: 'assistant', content: [] },
			});

		mockedExecuteAction.mockResolvedValue({
			success: true,
			message: 'Note "My Note" updated',
		});

		const result = await sendToAI(
			'claude',
			'sk-ant-test',
			'claude-sonnet-4-20250514',
			'rewrite the note',
			'My Note',
			'old body',
			{ currentNoteId: 'n1', currentNoteTitle: 'My Note' },
		);

		expect(result.isEdit).toBe(true);
		expect(result.actions[0].action).toBe('update_note');
	});

	it('handles multiple tool calls in a single round', async () => {
		mockedSendOpenAI
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [
					{ id: 'tc_a', name: 'search_notes', args: { query: 'meeting' } },
					{ id: 'tc_b', name: 'list_notebooks', args: {} },
				],
				finishReason: 'tool_calls',
				rawAssistantMessage: { content: null, tool_calls: [] },
			})
			.mockResolvedValueOnce({
				textContent: 'Found results and listed notebooks.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'Found results and listed notebooks.' },
			});

		mockedExecuteAction
			.mockResolvedValueOnce({
				success: true,
				message: 'Found 3 note(s)',
				data: { notes: [] },
			})
			.mockResolvedValueOnce({
				success: true,
				message: 'Found 2 notebook(s)',
				data: { notebooks: [] },
			});

		const result = await sendToAI(
			'openai',
			'sk-test',
			'gpt-4o',
			'find meeting notes and list folders',
			'Title',
			'Body',
			{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
		);

		expect(mockedExecuteAction).toHaveBeenCalledTimes(2);
		expect(result.actions).toHaveLength(2);
		expect(result.actions[0].action).toBe('search_notes');
		expect(result.actions[1].action).toBe('list_notebooks');
	});

	it('handles multi-round tool calling', async () => {
		mockedSendOpenAI
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [{ id: 'tc_1', name: 'search_notes', args: { query: 'draft' } }],
				finishReason: 'tool_calls',
				rawAssistantMessage: { content: null, tool_calls: [] },
			})
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [{ id: 'tc_2', name: 'get_note', args: { noteId: 'found-1' } }],
				finishReason: 'tool_calls',
				rawAssistantMessage: { content: null, tool_calls: [] },
			})
			.mockResolvedValueOnce({
				textContent: 'Here is what I found in the draft note.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'Here is what I found in the draft note.' },
			});

		mockedExecuteAction
			.mockResolvedValueOnce({
				success: true,
				message: 'Found 1 note(s)',
				data: { notes: [{ id: 'found-1', title: 'Draft' }] },
			})
			.mockResolvedValueOnce({
				success: true,
				message: 'Read note "Draft"',
				data: { id: 'found-1', title: 'Draft', body: 'draft content' },
			});

		const result = await sendToAI(
			'openai',
			'sk-test',
			'gpt-4o',
			'find and read my draft',
			'Title',
			'Body',
			{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
		);

		expect(mockedSendOpenAI).toHaveBeenCalledTimes(3);
		expect(mockedExecuteAction).toHaveBeenCalledTimes(2);
		expect(result.actions).toHaveLength(2);
		expect(result.actions[0].action).toBe('search_notes');
		expect(result.actions[1].action).toBe('get_note');
		expect(result.content).toBe('Here is what I found in the draft note.');
	});

	it('isEdit=false when no update_note action', async () => {
		mockedSendOpenAI
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [{ id: 'tc_1', name: 'add_tag', args: { tag: 'important' } }],
				finishReason: 'tool_calls',
				rawAssistantMessage: { content: null, tool_calls: [] },
			})
			.mockResolvedValueOnce({
				textContent: 'Tag added.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'Tag added.' },
			});

		mockedExecuteAction.mockResolvedValue({
			success: true,
			message: 'Tag "important" added',
		});

		const result = await sendToAI(
			'openai',
			'sk-test',
			'gpt-4o',
			'tag this as important',
			'Title',
			'Body',
			{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
		);

		expect(result.isEdit).toBe(false);
		expect(result.actions[0].action).toBe('add_tag');
	});

	it('propagates errors from the provider', async () => {
		mockedSendOpenAI.mockRejectedValue(new Error('Rate limit exceeded'));

		await expect(sendToAI('openai', 'sk-test', 'gpt-4o', 'test', 'T', 'B')).rejects.toThrow(
			'Rate limit exceeded',
		);
	});
});
