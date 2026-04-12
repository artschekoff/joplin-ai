import * as https from 'https';
import { EventEmitter } from 'events';
import { performWebSearch, WebSearchResult } from '../web-search';

jest.mock('https');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createMockResponse = (statusCode: number, body: string): any => {
	const res = new EventEmitter();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(res as any).statusCode = statusCode;
	process.nextTick(() => {
		res.emit('data', Buffer.from(body));
		res.emit('end');
	});
	return res;
};

const createMockRequest = () => {
	const req = new EventEmitter();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(req as any).write = jest.fn();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(req as any).end = jest.fn();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(req as any).setTimeout = jest.fn();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(req as any).destroy = jest.fn();
	return req;
};

const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

beforeEach(() => jest.clearAllMocks());

describe('performWebSearch', () => {
	it('sends a request to OpenAI chat completions endpoint', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				choices: [{ message: { content: 'Results.', annotations: [] }, finish_reason: 'stop' }],
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await performWebSearch('sk-test', 'latest AI news');

		expect(mockedRequest).toHaveBeenCalledTimes(1);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const callOpts = mockedRequest.mock.calls[0][0] as any;
		expect(callOpts.hostname).toBe('api.openai.com');
		expect(callOpts.path).toBe('/v1/chat/completions');
	});

	it('uses gpt-4o-search-preview model in the request body', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				choices: [{ message: { content: 'Results', annotations: [] }, finish_reason: 'stop' }],
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await performWebSearch('sk-test', 'test query');

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.model).toBe('gpt-4o-search-preview');
	});

	it('returns content and empty citations when no annotations', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				choices: [
					{
						message: { content: 'The answer is 42.', annotations: [] },
						finish_reason: 'stop',
					},
				],
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const result = await performWebSearch('sk-test', 'meaning of life');

		expect(result.content).toBe('The answer is 42.');
		expect(result.citations).toEqual([]);
	});

	it('returns citations from response annotations', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				choices: [
					{
						message: {
							content: 'According to sources, AI is advancing rapidly.',
							annotations: [
								{
									type: 'url_citation',
									url: 'https://example.com/ai',
									title: 'AI News',
									start_index: 0,
									end_index: 22,
								},
								{
									type: 'url_citation',
									url: 'https://other.com/tech',
									title: 'Tech Update',
									start_index: 23,
									end_index: 46,
								},
							],
						},
						finish_reason: 'stop',
					},
				],
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const result = await performWebSearch('sk-test', 'AI news');

		expect(result.citations).toHaveLength(2);
		expect(result.citations[0]).toEqual({
			url: 'https://example.com/ai',
			title: 'AI News',
		});
		expect(result.citations[1]).toEqual({
			url: 'https://other.com/tech',
			title: 'Tech Update',
		});
	});

	it('handles null annotations gracefully', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				choices: [{ message: { content: 'Some result' }, finish_reason: 'stop' }],
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const result = await performWebSearch('sk-test', 'test');

		expect(result.content).toBe('Some result');
		expect(result.citations).toEqual([]);
	});

	it('throws on empty response', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, JSON.stringify({ choices: [] }));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(performWebSearch('sk-test', 'test')).rejects.toThrow(
			'Empty response from OpenAI web search',
		);
	});

	it('throws on API error', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(performWebSearch('sk-test', 'test')).rejects.toThrow('Rate limit exceeded');
	});

	it('throws when API key is empty', async () => {
		await expect(performWebSearch('', 'test')).rejects.toThrow(
			'OpenAI API key is required for web search',
		);
	});

	it('throws when query is empty', async () => {
		await expect(performWebSearch('sk-test', '')).rejects.toThrow('Search query cannot be empty');
	});

	it('includes the query in the user message', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				choices: [{ message: { content: 'Results', annotations: [] }, finish_reason: 'stop' }],
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await performWebSearch('sk-test', 'What is quantum computing?');

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		const userMsg = parsed.messages.find((m: { role: string }) => m.role === 'user');
		expect(userMsg.content).toContain('What is quantum computing?');
	});
});

describe('WebSearchResult type', () => {
	it('has content and citations fields', () => {
		const result: WebSearchResult = {
			content: 'test',
			citations: [{ url: 'https://example.com', title: 'Example' }],
		};
		expect(result.content).toBe('test');
		expect(result.citations).toHaveLength(1);
	});
});
