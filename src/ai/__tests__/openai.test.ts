import * as https from 'https';
import { EventEmitter } from 'events';
import { callOpenAI, sendOpenAIMessages, isReasoningModel } from '../openai';

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

/**
 * Simulates a TCP-chunked response where a multi-byte UTF-8 character
 * (Cyrillic "и" = U+0438 = 0xD0 0xB8) is split across two chunks.
 * Without StringDecoder, each half decodes to U+FFFD independently.
 */
function createMockResponseSplitAtUtf8Boundary(statusCode: number, body: string) {
	const res = new EventEmitter();
	(res as any).statusCode = statusCode;
	const rawBytes = Buffer.from(body, 'utf8');
	// Find the first occurrence of 0xD0 (first byte of а Cyrillic 2-byte sequence)
	// and split right after it so the second byte lands in the next chunk.
	let splitIndex = -1;
	for (let i = 0; i < rawBytes.length - 1; i++) {
		if (rawBytes[i] === 0xd0 && rawBytes[i + 1] >= 0x80) {
			splitIndex = i + 1; // split after the first byte, before the continuation
			break;
		}
	}
	if (splitIndex === -1) {
		throw new Error('No splittable UTF-8 sequence found in body');
	}
	const chunk1 = rawBytes.subarray(0, splitIndex);
	const chunk2 = rawBytes.subarray(splitIndex);
	process.nextTick(() => {
		res.emit('data', chunk1);
		res.emit('data', chunk2);
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

	it('correctly decodes Cyrillic text when a UTF-8 multi-byte character is split across TCP chunks', async () => {
		const inputCyrillicContent = 'с маппингом полей между 1С и интернет-магазином';
		const mockReq = createMockRequest();
		const mockRes = createMockResponseSplitAtUtf8Boundary(
			200,
			JSON.stringify({
				choices: [{ message: { content: inputCyrillicContent }, finish_reason: 'stop' }],
			}),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const actualResult = await callOpenAI('sk-test', 'gpt-4o', 'sys', 'usr');
		expect(actualResult).toBe(inputCyrillicContent);
		expect(actualResult).not.toContain('\uFFFD');
	});
});

describe('isReasoningModel', () => {
	it('returns true for o3', () => {
		expect(isReasoningModel('o3')).toBe(true);
	});

	it('returns true for o4-mini', () => {
		expect(isReasoningModel('o4-mini')).toBe(true);
	});

	it('returns true for codex-mini-latest', () => {
		expect(isReasoningModel('codex-mini-latest')).toBe(true);
	});

	it('returns false for gpt-4o', () => {
		expect(isReasoningModel('gpt-4o')).toBe(false);
	});

	it('returns false for gpt-4o-mini', () => {
		expect(isReasoningModel('gpt-4o-mini')).toBe(false);
	});

	it('returns false for gpt-4.1-mini', () => {
		expect(isReasoningModel('gpt-4.1-mini')).toBe(false);
	});

	it('returns false for gpt-5.4', () => {
		expect(isReasoningModel('gpt-5.4')).toBe(false);
	});
});

describe('sendOpenAIMessages — temperature handling', () => {
	const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

	function setupMockRequest(responseBody: object) {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, JSON.stringify(responseBody));
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});
		return mockReq;
	}

	const successResponse = {
		choices: [{ message: { content: 'ok', tool_calls: [] }, finish_reason: 'stop' }],
	};

	beforeEach(() => jest.clearAllMocks());

	it('omits temperature for o3', async () => {
		const mockReq = setupMockRequest(successResponse);
		await sendOpenAIMessages('sk-test', 'o3', [{ role: 'user', content: 'hi' }]);
		const body = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(body).not.toHaveProperty('temperature');
	});

	it('omits temperature for o4-mini', async () => {
		const mockReq = setupMockRequest(successResponse);
		await sendOpenAIMessages('sk-test', 'o4-mini', [{ role: 'user', content: 'hi' }]);
		const body = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(body).not.toHaveProperty('temperature');
	});

	it('omits temperature for codex-mini-latest', async () => {
		const mockReq = setupMockRequest(successResponse);
		await sendOpenAIMessages('sk-test', 'codex-mini-latest', [{ role: 'user', content: 'hi' }]);
		const body = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(body).not.toHaveProperty('temperature');
	});

	it('includes temperature for gpt-4o', async () => {
		const mockReq = setupMockRequest(successResponse);
		await sendOpenAIMessages('sk-test', 'gpt-4o', [{ role: 'user', content: 'hi' }]);
		const body = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(body).toHaveProperty('temperature', 0.3);
	});

	it('includes temperature for gpt-4o-mini', async () => {
		const mockReq = setupMockRequest(successResponse);
		await sendOpenAIMessages('sk-test', 'gpt-4o-mini', [{ role: 'user', content: 'hi' }]);
		const body = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(body).toHaveProperty('temperature', 0.3);
	});

	it('includes temperature for gpt-4.1-mini', async () => {
		const mockReq = setupMockRequest(successResponse);
		await sendOpenAIMessages('sk-test', 'gpt-4.1-mini', [{ role: 'user', content: 'hi' }]);
		const body = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(body).toHaveProperty('temperature', 0.3);
	});
});
