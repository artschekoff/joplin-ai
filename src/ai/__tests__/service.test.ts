import { parseResponse, buildSystemPrompt, sendToAI } from '../service';

jest.mock('../openai', () => ({
	callOpenAI: jest.fn(),
}));
jest.mock('../claude', () => ({
	callClaude: jest.fn(),
}));

import { callOpenAI } from '../openai';
import { callClaude } from '../claude';

const mockedCallOpenAI = callOpenAI as jest.MockedFunction<typeof callOpenAI>;
const mockedCallClaude = callClaude as jest.MockedFunction<typeof callClaude>;

describe('parseResponse', () => {
	it('returns isEdit=false for plain text response', () => {
		const result = parseResponse('This is a regular answer about your note.');
		expect(result.isEdit).toBe(false);
		expect(result.content).toBe('This is a regular answer about your note.');
		expect(result.editedBody).toBeUndefined();
	});

	it('returns isEdit=true when response contains <note_edit> tags', () => {
		const raw = '<note_edit>\n# Updated Title\nNew body content\n</note_edit>';
		const result = parseResponse(raw);
		expect(result.isEdit).toBe(true);
		expect(result.editedBody).toBe('# Updated Title\nNew body content');
		expect(result.content).toBe(raw);
	});

	it('extracts content between tags ignoring surrounding text', () => {
		const raw = 'Some preamble\n<note_edit>Edited content here</note_edit>\nsome trailing text';
		const result = parseResponse(raw);
		expect(result.isEdit).toBe(true);
		expect(result.editedBody).toBe('Edited content here');
	});

	it('returns isEdit=false if only opening tag is present', () => {
		const result = parseResponse('Here is <note_edit> but no closing tag');
		expect(result.isEdit).toBe(false);
	});

	it('returns isEdit=false if only closing tag is present', () => {
		const result = parseResponse('Here is </note_edit> but no opening tag');
		expect(result.isEdit).toBe(false);
	});

	it('returns isEdit=false when closing tag comes before opening tag', () => {
		const result = parseResponse('</note_edit> then <note_edit>');
		expect(result.isEdit).toBe(false);
	});

	it('handles empty content between tags', () => {
		const result = parseResponse('<note_edit></note_edit>');
		expect(result.isEdit).toBe(true);
		expect(result.editedBody).toBe('');
	});

	it('handles multiline markdown content in edit', () => {
		const body = `# My Note

- Item 1
- Item 2

Some paragraph with **bold** text.`;
		const raw = `<note_edit>\n${body}\n</note_edit>`;
		const result = parseResponse(raw);
		expect(result.isEdit).toBe(true);
		expect(result.editedBody).toBe(body);
	});
});

describe('buildSystemPrompt', () => {
	it('includes note title and body', () => {
		const prompt = buildSystemPrompt('My Note', 'Hello world');
		expect(prompt).toContain('Current note title: My Note');
		expect(prompt).toContain('Hello world');
	});

	it('includes instructions about <note_edit> tags', () => {
		const prompt = buildSystemPrompt('Test', 'Body');
		expect(prompt).toContain('<note_edit>');
		expect(prompt).toContain('</note_edit>');
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

describe('sendToAI', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('API key validation', () => {
		it('throws when API key is empty string', async () => {
			await expect(sendToAI('openai', '', 'gpt-4o', 'hello', 'Title', 'Body')).rejects.toThrow(
				'API key for openai is not configured',
			);
			expect(mockedCallOpenAI).not.toHaveBeenCalled();
		});

		it('throws when API key is whitespace only', async () => {
			await expect(
				sendToAI('claude', '   ', 'claude-sonnet-4-20250514', 'hello', 'Title', 'Body'),
			).rejects.toThrow('API key for claude is not configured');
			expect(mockedCallClaude).not.toHaveBeenCalled();
		});

		it('throws with provider name in error message for openai', async () => {
			await expect(sendToAI('openai', '', 'gpt-4o', 'test', 'T', 'B')).rejects.toThrow(/openai/);
		});

		it('throws with provider name in error message for claude', async () => {
			await expect(
				sendToAI('claude', '', 'claude-sonnet-4-20250514', 'test', 'T', 'B'),
			).rejects.toThrow(/claude/);
		});

		it('does not throw when API key is valid', async () => {
			mockedCallOpenAI.mockResolvedValue('ok');
			await expect(
				sendToAI('openai', 'sk-valid-key', 'gpt-4o', 'hello', 'Title', 'Body'),
			).resolves.toBeDefined();
		});
	});

	it('routes to OpenAI when provider is "openai"', async () => {
		mockedCallOpenAI.mockResolvedValue('Plain answer from OpenAI');

		const result = await sendToAI('openai', 'sk-test', 'gpt-4o', 'What is this?', 'Title', 'Body');

		expect(mockedCallOpenAI).toHaveBeenCalledTimes(1);
		expect(mockedCallClaude).not.toHaveBeenCalled();
		expect(result.isEdit).toBe(false);
		expect(result.content).toBe('Plain answer from OpenAI');
	});

	it('routes to Claude when provider is "claude"', async () => {
		mockedCallClaude.mockResolvedValue('Answer from Claude');

		const result = await sendToAI(
			'claude',
			'sk-ant-test',
			'claude-sonnet-4-20250514',
			'Explain',
			'Title',
			'Body',
		);

		expect(mockedCallClaude).toHaveBeenCalledTimes(1);
		expect(mockedCallOpenAI).not.toHaveBeenCalled();
		expect(result.isEdit).toBe(false);
		expect(result.content).toBe('Answer from Claude');
	});

	it('passes system prompt with note context to provider', async () => {
		mockedCallOpenAI.mockResolvedValue('ok');

		await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'My Title', 'My Body');

		const systemPrompt = mockedCallOpenAI.mock.calls[0][2];
		expect(systemPrompt).toContain('Current note title: My Title');
		expect(systemPrompt).toContain('My Body');
	});

	it('detects edit response from AI', async () => {
		mockedCallOpenAI.mockResolvedValue('<note_edit># New content\nUpdated.</note_edit>');

		const result = await sendToAI('openai', 'sk-test', 'gpt-4o', 'rewrite this', 'Title', 'Body');

		expect(result.isEdit).toBe(true);
		expect(result.editedBody).toBe('# New content\nUpdated.');
	});

	it('propagates errors from the provider', async () => {
		mockedCallOpenAI.mockRejectedValue(new Error('Rate limit exceeded'));

		await expect(sendToAI('openai', 'sk-test', 'gpt-4o', 'test', 'T', 'B')).rejects.toThrow(
			'Rate limit exceeded',
		);
	});
});
