import * as https from 'https';
import { EventEmitter } from 'events';
import { callOpenAI } from '../openai';

jest.mock('https');

function createMockResponse(statusCode: number, body: string) {
	const res = new EventEmitter();
	(res as any).statusCode = statusCode;
	process.nextTick(() => {
		res.emit('data', Buffer.from(body));
		res.emit('end');
	});
	return res;
}

function createMockRequest() {
	const req = new EventEmitter();
	(req as any).write = jest.fn();
	(req as any).end = jest.fn();
	return req;
}

describe('callOpenAI', () => {
	const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('resolves with the message content on success', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				choices: [{ message: { content: 'Hello from GPT' } }],
			}),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await callOpenAI('sk-test', 'gpt-4o', 'system', 'user prompt');
		expect(result).toBe('Hello from GPT');
	});

	it('sends correct headers and body', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				choices: [{ message: { content: 'ok' } }],
			}),
		);

		mockedRequest.mockImplementation((opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await callOpenAI('sk-key-123', 'gpt-4o-mini', 'sys prompt', 'user msg');

		const opts = mockedRequest.mock.calls[0][0] as any;
		expect(opts.hostname).toBe('api.openai.com');
		expect(opts.path).toBe('/v1/chat/completions');
		expect(opts.method).toBe('POST');
		expect(opts.headers['Authorization']).toBe('Bearer sk-key-123');

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.model).toBe('gpt-4o-mini');
		expect(writtenBody.messages).toEqual([
			{ role: 'system', content: 'sys prompt' },
			{ role: 'user', content: 'user msg' },
		]);
	});

	it('rejects when API returns error object', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			401,
			JSON.stringify({
				error: { message: 'Invalid API key' },
			}),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(callOpenAI('bad-key', 'gpt-4o', 'sys', 'usr')).rejects.toThrow('Invalid API key');
	});

	it('rejects when response has no choices', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, JSON.stringify({ choices: [] }));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(callOpenAI('sk-test', 'gpt-4o', 'sys', 'usr')).rejects.toThrow(
			'Empty response from OpenAI',
		);
	});

	it('rejects when response is not valid JSON', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, 'not json at all');

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(callOpenAI('sk-test', 'gpt-4o', 'sys', 'usr')).rejects.toThrow(
			'Failed to parse OpenAI response',
		);
	});

	it('rejects on network error', async () => {
		const mockReq = createMockRequest();

		mockedRequest.mockImplementation((_opts: any, _callback: any) => {
			process.nextTick(() => mockReq.emit('error', new Error('ECONNREFUSED')));
			return mockReq as any;
		});

		await expect(callOpenAI('sk-test', 'gpt-4o', 'sys', 'usr')).rejects.toThrow(
			'OpenAI request failed: ECONNREFUSED',
		);
	});
});
