import * as https from 'https';
import { EventEmitter } from 'events';
import { streamOpenAIMessages } from '../openai';
import { streamClaudeMessages } from '../claude';

jest.mock('https');

const createMockRequest = () => {
	const req = new EventEmitter();
	(req as any).write = jest.fn();
	(req as any).end = jest.fn();
	return req;
};

const createSSEResponse = (statusCode: number, events: string[]) => {
	const res = new EventEmitter();
	(res as any).statusCode = statusCode;
	process.nextTick(() => {
		for (const event of events) {
			res.emit('data', Buffer.from(event));
		}
		res.emit('end');
	});
	return res;
};

describe('streamOpenAIMessages', () => {
	const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

	beforeEach(() => jest.clearAllMocks());

	it('calls onChunk for each text delta', async () => {
		const mockReq = createMockRequest();
		const sseData = [
			'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
			'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n',
			'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
			'data: [DONE]\n\n',
		];
		const mockRes = createSSEResponse(200, sseData);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const chunks: string[] = [];
		const result = await streamOpenAIMessages(
			'sk-test',
			'gpt-4o',
			[{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
			(chunk) => chunks.push(chunk),
		);

		expect(chunks).toEqual(['Hello', ' world']);
		expect(result.textContent).toBe('Hello world');
		expect(result.usage).toBeDefined();
		expect(result.usage!.inputTokens).toBe(10);
		expect(result.usage!.outputTokens).toBe(5);
	});

	it('sets stream:true in the request body', async () => {
		const mockReq = createMockRequest();
		const sseData = [
			'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
			'data: [DONE]\n\n',
		];
		const mockRes = createSSEResponse(200, sseData);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await streamOpenAIMessages(
			'sk-test',
			'gpt-4o',
			[{ role: 'user', content: 'hi' }],
			() => {},
		);

		const body = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
	});

	it('detects tool calls from streaming response', async () => {
		const mockReq = createMockRequest();
		const sseData = [
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_notes","arguments":""}}]},"finish_reason":null}]}\n\n',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":"}}]},"finish_reason":null}]}\n\n',
			'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test\\"}"}}]},"finish_reason":null}]}\n\n',
			'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":15,"completion_tokens":10}}\n\n',
			'data: [DONE]\n\n',
		];
		const mockRes = createSSEResponse(200, sseData);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await streamOpenAIMessages(
			'sk-test',
			'gpt-4o',
			[{ role: 'user', content: 'search' }],
			() => {},
		);

		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].name).toBe('search_notes');
		expect(result.toolCalls[0].args).toEqual({ query: 'test' });
	});

	it('rejects on API error in streaming mode', async () => {
		const mockReq = createMockRequest();
		const mockRes = createSSEResponse(200, [
			'data: {"error":{"message":"Rate limit exceeded"}}\n\n',
		]);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(
			streamOpenAIMessages('sk-test', 'gpt-4o', [{ role: 'user', content: 'hi' }], () => {}),
		).rejects.toThrow('Rate limit exceeded');
	});
});

describe('streamClaudeMessages', () => {
	const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

	beforeEach(() => jest.clearAllMocks());

	it('calls onChunk for each text delta', async () => {
		const mockReq = createMockRequest();
		const sseData = [
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		];
		const mockRes = createSSEResponse(200, sseData);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const chunks: string[] = [];
		const result = await streamClaudeMessages(
			'sk-ant-test',
			'claude-sonnet-4-20250514',
			'system prompt',
			[{ role: 'user', content: 'hi' }],
			(chunk) => chunks.push(chunk),
		);

		expect(chunks).toEqual(['Hello', ' world']);
		expect(result.textContent).toBe('Hello world');
	});

	it('sets stream:true in the request body', async () => {
		const mockReq = createMockRequest();
		const sseData = [
			'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		];
		const mockRes = createSSEResponse(200, sseData);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await streamClaudeMessages(
			'sk-ant-test',
			'claude-sonnet-4-20250514',
			'sys',
			[{ role: 'user', content: 'hi' }],
			() => {},
		);

		const body = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(body.stream).toBe(true);
	});

	it('extracts usage from message_start and message_delta events', async () => {
		const mockReq = createMockRequest();
		const sseData = [
			'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":25}}}\n\n',
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Done"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		];
		const mockRes = createSSEResponse(200, sseData);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await streamClaudeMessages(
			'sk-ant-test',
			'claude-sonnet-4-20250514',
			'sys',
			[{ role: 'user', content: 'hi' }],
			() => {},
		);

		expect(result.usage).toBeDefined();
		expect(result.usage!.inputTokens).toBe(25);
		expect(result.usage!.outputTokens).toBe(12);
	});

	it('detects tool_use blocks from streaming response', async () => {
		const mockReq = createMockRequest();
		const sseData = [
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tc_1","name":"search_notes","input":{}}}\n\n',
			'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\":\\"test\\"}"}}\n\n',
			'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
			'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}\n\n',
			'event: message_stop\ndata: {"type":"message_stop"}\n\n',
		];
		const mockRes = createSSEResponse(200, sseData);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await streamClaudeMessages(
			'sk-ant-test',
			'claude-sonnet-4-20250514',
			'sys',
			[{ role: 'user', content: 'search' }],
			() => {},
		);

		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].name).toBe('search_notes');
		expect(result.toolCalls[0].args).toEqual({ query: 'test' });
	});
});
