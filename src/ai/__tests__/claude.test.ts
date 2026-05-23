import * as https from 'https';
import { EventEmitter } from 'events';
import { callClaude } from '../claude';

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

describe('callClaude', () => {
	const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('resolves with the text content on success', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				content: [{ type: 'text', text: 'Hello from Claude' }],
			}),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await callClaude('sk-ant-test', 'claude-sonnet-4-6', 'system', 'user prompt');
		expect(result).toBe('Hello from Claude');
	});

	it('sends correct headers and body', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				content: [{ type: 'text', text: 'ok' }],
			}),
		);

		mockedRequest.mockImplementation((opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await callClaude('ant-key-456', 'claude-3-haiku-20240307', 'sys prompt', 'user msg');

		const opts = mockedRequest.mock.calls[0][0] as any;
		expect(opts.hostname).toBe('api.anthropic.com');
		expect(opts.path).toBe('/v1/messages');
		expect(opts.method).toBe('POST');
		expect(opts.headers['x-api-key']).toBe('ant-key-456');
		expect(opts.headers['anthropic-version']).toBe('2023-06-01');

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.model).toBe('claude-3-haiku-20240307');
		expect(writtenBody.max_tokens).toBe(4096);
		expect(writtenBody.system).toBe('sys prompt');
		expect(writtenBody.messages).toEqual([{ role: 'user', content: 'user msg' }]);
	});

	it('rejects when API returns error object', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			401,
			JSON.stringify({
				error: { message: 'Invalid x-api-key' },
			}),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(callClaude('bad-key', 'claude-sonnet-4-6', 'sys', 'usr')).rejects.toThrow(
			'Invalid x-api-key',
		);
	});

	it('rejects when response has empty content array', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, JSON.stringify({ content: [] }));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(callClaude('sk-test', 'claude-sonnet-4-6', 'sys', 'usr')).rejects.toThrow(
			'Empty response from Claude',
		);
	});

	it('rejects when response is not valid JSON', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, '<html>Server Error</html>');

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(callClaude('sk-test', 'claude-sonnet-4-6', 'sys', 'usr')).rejects.toThrow(
			'Failed to parse Claude response',
		);
	});

	it('rejects on network error', async () => {
		const mockReq = createMockRequest();

		mockedRequest.mockImplementation((_opts: any, _callback: any) => {
			process.nextTick(() => mockReq.emit('error', new Error('ETIMEDOUT')));
			return mockReq as any;
		});

		await expect(callClaude('sk-test', 'claude-sonnet-4-6', 'sys', 'usr')).rejects.toThrow(
			'Claude request failed: ETIMEDOUT',
		);
	});
});
