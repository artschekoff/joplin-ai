import * as https from 'https';
import { EventEmitter } from 'events';
import {
	sendPerplexityRequest,
	callPerplexity,
	sendSonarChatRequest,
	isSonarApiModel,
	getTimeoutMs,
	parseSonarToolCalls,
	buildSonarToolCallPrompt,
} from '../perplexity';
import { PerplexityTool } from '../tools';

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
	(req as any).setTimeout = jest.fn();
	(req as any).destroy = jest.fn();
	return req;
}

/** Helper to build an Agent API response with text output. */
const agentTextResponse = (text: string) =>
	JSON.stringify({
		output: [
			{
				type: 'message',
				id: 'msg_1',
				role: 'assistant',
				status: 'completed',
				content: [{ type: 'output_text', text }],
			},
		],
	});

/** Helper to build an Agent API response with a function call. */
const agentFunctionCallResponse = (callId: string, name: string, args: string) =>
	JSON.stringify({
		output: [
			{
				type: 'function_call',
				id: 'fc_1',
				call_id: callId,
				name,
				arguments: args,
				status: 'completed',
			},
		],
	});

describe('sendPerplexityRequest', () => {
	const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('sends requests to /v1/agent on api.perplexity.ai', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('Hello'));

		mockedRequest.mockImplementation((opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'hello');

		const opts = mockedRequest.mock.calls[0][0] as any;
		expect(opts.hostname).toBe('api.perplexity.ai');
		expect(opts.path).toBe('/v1/agent');
		expect(opts.method).toBe('POST');
		expect(opts.headers['Authorization']).toBe('Bearer pplx-key');
		expect(opts.headers['Content-Type']).toBe('application/json');
	});

	it('returns text content from a successful response', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('Perplexity answer'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test');

		expect(result.textContent).toBe('Perplexity answer');
		expect(result.toolCalls).toEqual([]);
		expect(result.finishReason).toBe('stop');
	});

	it('parses function calls from the response', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			agentFunctionCallResponse('call_abc', 'search_notes', '{"query":"meeting"}'),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const tools = [
			{
				type: 'function' as const,
				name: 'search_notes',
				description: 'Search notes',
				parameters: { type: 'object', properties: {} },
			},
		];

		const result = await sendPerplexityRequest(
			'pplx-key',
			'perplexity/sonar',
			'find notes',
			undefined,
			tools,
		);

		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0]).toEqual({
			id: 'call_abc',
			name: 'search_notes',
			args: { query: 'meeting' },
		});
		expect(result.textContent).toBeNull();
		expect(result.finishReason).toBe('tool_calls');
	});

	it('sends tools in flat Perplexity format (not nested OpenAI format)', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('ok'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const tools = [
			{
				type: 'function' as const,
				name: 'get_note',
				description: 'Get a note',
				parameters: { type: 'object', properties: {} },
			},
		];

		await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test', undefined, tools);

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.tools).toEqual(tools);
		expect(writtenBody.tools[0]).not.toHaveProperty('function');
		expect(writtenBody.tools[0].name).toBe('get_note');
		expect(writtenBody.tools[0].parameters).toEqual({ type: 'object', properties: {} });
	});

	it('does not include tools in request body when not provided', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('ok'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test');

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.tools).toBeUndefined();
	});

	it('sends instructions (system prompt) in request body', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('ok'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await sendPerplexityRequest(
			'pplx-key',
			'perplexity/sonar',
			'test',
			'You are a helpful assistant.',
		);

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.instructions).toBe('You are a helpful assistant.');
		expect(writtenBody.input).toBe('test');
	});

	it('omits instructions when not provided', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('ok'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test');

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.instructions).toBeUndefined();
	});

	it('accepts array input for multi-turn conversations', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('I recall that'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const inputItems = [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
			{ role: 'user', content: 'What did I say?' },
		];

		await sendPerplexityRequest('pplx-key', 'perplexity/sonar', inputItems);

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.input).toEqual(inputItems);
	});

	it('accepts array input with function call outputs', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('Found your notes.'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const inputItems = [
			{
				type: 'function_call',
				call_id: 'call_1',
				name: 'search_notes',
				arguments: '{"query":"meeting"}',
			},
			{
				type: 'function_call_output',
				call_id: 'call_1',
				output: '{"success":true}',
			},
		];

		await sendPerplexityRequest('pplx-key', 'perplexity/sonar', inputItems, 'system');

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.input).toEqual(inputItems);
	});

	it('returns raw output items as rawAssistantMessage', async () => {
		const mockReq = createMockRequest();
		const outputItems = [
			{
				type: 'message',
				id: 'msg_1',
				role: 'assistant',
				status: 'completed',
				content: [{ type: 'output_text', text: 'Hello' }],
			},
		];
		const mockRes = createMockResponse(200, JSON.stringify({ output: outputItems }));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test');
		expect(result.rawAssistantMessage).toEqual(outputItems);
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

		await expect(sendPerplexityRequest('bad-key', 'perplexity/sonar', 'test')).rejects.toThrow(
			'Invalid API key',
		);
	});

	it('rejects when response has empty output', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, JSON.stringify({ output: [] }));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test')).rejects.toThrow(
			'Empty response from Perplexity',
		);
	});

	it('rejects when response is not valid JSON', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, 'not json');

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test')).rejects.toThrow(
			'Failed to parse Perplexity response',
		);
	});

	it('rejects on network error', async () => {
		const mockReq = createMockRequest();

		mockedRequest.mockImplementation((_opts: any, _callback: any) => {
			process.nextTick(() => mockReq.emit('error', new Error('ECONNREFUSED')));
			return mockReq as any;
		});

		await expect(sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test')).rejects.toThrow(
			'Perplexity request failed: ECONNREFUSED',
		);
	});

	it('prefixes model with perplexity/ for Agent API when not already prefixed', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('ok'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await sendPerplexityRequest('pplx-key', 'sonar', 'test');

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.model).toBe('perplexity/sonar');
	});

	it('keeps perplexity/ prefix when already present', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('ok'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test');

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.model).toBe('perplexity/sonar');
	});

	it('returns token usage from Agent API response', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				output: [
					{
						type: 'message',
						id: 'msg_1',
						role: 'assistant',
						status: 'completed',
						content: [{ type: 'output_text', text: 'Hello' }],
					},
				],
				usage: { prompt_tokens: 200, completion_tokens: 50 },
			}),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test');

		expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 50 });
	});

	it('returns zero usage when Agent API response has no usage field', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('Hello'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'test');

		expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
	});

	it('handles response with both text and function calls', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				output: [
					{
						type: 'message',
						id: 'msg_1',
						role: 'assistant',
						status: 'completed',
						content: [{ type: 'output_text', text: 'Let me search for that.' }],
					},
					{
						type: 'function_call',
						id: 'fc_1',
						call_id: 'call_mix',
						name: 'search_notes',
						arguments: '{"query":"test"}',
						status: 'completed',
					},
				],
			}),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await sendPerplexityRequest('pplx-key', 'perplexity/sonar', 'find test notes');

		expect(result.textContent).toBe('Let me search for that.');
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].name).toBe('search_notes');
		expect(result.finishReason).toBe('tool_calls');
	});
});

describe('callPerplexity', () => {
	const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('resolves with the message content on success', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('Hello from Perplexity'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await callPerplexity(
			'pplx-key',
			'perplexity/sonar',
			'system prompt',
			'user prompt',
		);
		expect(result).toBe('Hello from Perplexity');
	});

	it('sends user prompt as input and system prompt as instructions', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, agentTextResponse('ok'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await callPerplexity('pplx-key', 'perplexity/sonar', 'sys prompt', 'user msg');

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.input).toBe('user msg');
		expect(writtenBody.instructions).toBe('sys prompt');
	});

	it('rejects when response has no text content', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			JSON.stringify({
				output: [
					{
						type: 'message',
						id: 'msg_1',
						role: 'assistant',
						status: 'completed',
						content: [{ type: 'output_text', text: '' }],
					},
				],
			}),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(callPerplexity('pplx-key', 'perplexity/sonar', 'sys', 'usr')).rejects.toThrow(
			'Empty response from Perplexity',
		);
	});
});

describe('isSonarApiModel', () => {
	it('returns true for sonar-pro', () => {
		expect(isSonarApiModel('sonar-pro')).toBe(true);
	});

	it('returns true for sonar-reasoning-pro', () => {
		expect(isSonarApiModel('sonar-reasoning-pro')).toBe(true);
	});

	it('returns true for sonar-deep-research', () => {
		expect(isSonarApiModel('sonar-deep-research')).toBe(true);
	});

	it('returns false for sonar (uses Agent API)', () => {
		expect(isSonarApiModel('sonar')).toBe(false);
	});

	it('returns false for unknown models', () => {
		expect(isSonarApiModel('gpt-4o')).toBe(false);
	});
});

/** Build an SSE response body for a Sonar streaming response. */
function sonarSseResponse(
	text: string,
	usage?: { prompt_tokens: number; completion_tokens: number },
): string {
	const lines: string[] = [
		`data: ${JSON.stringify({ id: 'chat_1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}`,
	];
	const finalChunk: Record<string, unknown> = {
		id: 'chat_1',
		object: 'chat.completion.chunk',
		choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
	};
	if (usage) finalChunk.usage = usage;
	lines.push(`data: ${JSON.stringify(finalChunk)}`);
	lines.push('data: [DONE]');
	return lines.join('\n') + '\n';
}

describe('sendSonarChatRequest', () => {
	const mockedRequest = https.request as jest.MockedFunction<typeof https.request>;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('sends requests to /v1/sonar on api.perplexity.ai', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, sonarSseResponse('Hello'));

		mockedRequest.mockImplementation((opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await sendSonarChatRequest('pplx-key', 'sonar-pro', [{ role: 'user', content: 'hello' }]);

		const opts = mockedRequest.mock.calls[0][0] as any;
		expect(opts.hostname).toBe('api.perplexity.ai');
		expect(opts.path).toBe('/v1/sonar');
		expect(opts.method).toBe('POST');
		expect(opts.headers['Authorization']).toBe('Bearer pplx-key');
	});

	it('sends model, messages, and stream:true in request body', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, sonarSseResponse('ok'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const messages = [
			{ role: 'system' as const, content: 'You are helpful.' },
			{ role: 'user' as const, content: 'hello' },
		];

		await sendSonarChatRequest('pplx-key', 'sonar-pro', messages);

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.model).toBe('sonar-pro');
		expect(writtenBody.messages).toEqual(messages);
		expect(writtenBody.stream).toBe(true);
		expect(writtenBody.input).toBeUndefined();
		expect(writtenBody.instructions).toBeUndefined();
	});

	it('returns text content accumulated from SSE chunks', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, sonarSseResponse('Sonar answer'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await sendSonarChatRequest('pplx-key', 'sonar-pro', [
			{ role: 'user', content: 'test' },
		]);

		expect(result.textContent).toBe('Sonar answer');
		expect(result.toolCalls).toEqual([]);
		expect(result.finishReason).toBe('stop');
	});

	it('accumulates text from multiple SSE chunks', async () => {
		const mockReq = createMockRequest();
		const multiChunkBody =
			[
				`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}`,
				`data: ${JSON.stringify({ choices: [{ delta: { content: ' world' } }] })}`,
				`data: ${JSON.stringify({ choices: [{ delta: { content: '!' } }] })}`,
				'data: [DONE]',
			].join('\n') + '\n';
		const mockRes = createMockResponse(200, multiChunkBody);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await sendSonarChatRequest('pplx-key', 'sonar-pro', [
			{ role: 'user', content: 'test' },
		]);

		expect(result.textContent).toBe('Hello world!');
	});

	it('calls onChunk for each text delta', async () => {
		const mockReq = createMockRequest();
		const multiChunkBody =
			[
				`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] })}`,
				`data: ${JSON.stringify({ choices: [{ delta: { content: ' world' } }] })}`,
				'data: [DONE]',
			].join('\n') + '\n';
		const mockRes = createMockResponse(200, multiChunkBody);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const chunks: string[] = [];
		await sendSonarChatRequest('pplx-key', 'sonar-pro', [{ role: 'user', content: 'test' }], (c) =>
			chunks.push(c),
		);

		expect(chunks).toEqual(['Hello', ' world']);
	});

	it('returns token usage from SSE usage chunk', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			200,
			sonarSseResponse('Hello', { prompt_tokens: 150, completion_tokens: 42 }),
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await sendSonarChatRequest('pplx-key', 'sonar-pro', [
			{ role: 'user', content: 'hello' },
		]);

		expect(result.usage).toEqual({ inputTokens: 150, outputTokens: 42 });
	});

	it('returns zero usage when SSE response has no usage chunk', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, sonarSseResponse('Hello'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const result = await sendSonarChatRequest('pplx-key', 'sonar-pro', [
			{ role: 'user', content: 'hello' },
		]);

		expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
	});

	it('rejects when SSE stream produces no text content', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, 'data: [DONE]\n');

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(
			sendSonarChatRequest('pplx-key', 'sonar-pro', [{ role: 'user', content: 'test' }]),
		).rejects.toThrow('Empty response from Perplexity Sonar');
	});

	it('rejects when SSE stream contains an error payload', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			401,
			`data: ${JSON.stringify({ error: { message: 'Invalid API key' } })}\n`,
		);

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		await expect(
			sendSonarChatRequest('bad-key', 'sonar-pro', [{ role: 'user', content: 'test' }]),
		).rejects.toThrow('Invalid API key');
	});

	it('passes conversation history in messages array', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(200, sonarSseResponse('I recall'));

		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any;
		});

		const messages = [
			{ role: 'system' as const, content: 'system prompt' },
			{ role: 'user' as const, content: 'Hello' },
			{ role: 'assistant' as const, content: 'Hi there!' },
			{ role: 'user' as const, content: 'What did I say?' },
		];

		await sendSonarChatRequest('pplx-key', 'sonar-pro', messages);

		const writtenBody = JSON.parse((mockReq as any).write.mock.calls[0][0]);
		expect(writtenBody.messages).toEqual(messages);
	});
});

describe('getTimeoutMs', () => {
	it('returns 120s for sonar-pro', () => {
		expect(getTimeoutMs('sonar-pro')).toBe(120_000);
	});

	it('returns 120s for sonar-reasoning-pro', () => {
		expect(getTimeoutMs('sonar-reasoning-pro')).toBe(120_000);
	});

	it('returns 300s for sonar-deep-research', () => {
		expect(getTimeoutMs('sonar-deep-research')).toBe(300_000);
	});

	it('returns 60s for sonar (basic model)', () => {
		expect(getTimeoutMs('sonar')).toBe(60_000);
	});

	it('returns 60s for unknown models', () => {
		expect(getTimeoutMs('gpt-4o')).toBe(60_000);
	});
});

describe('parseSonarToolCalls', () => {
	it('extracts a single tool call from response text', () => {
		const text =
			'Let me update that.\n[TOOL_CALL]{"name":"update_note","args":{"body":"new content"}}[/TOOL_CALL]';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].name).toBe('update_note');
		expect(result.toolCalls[0].args).toEqual({ body: 'new content' });
		expect(result.toolCalls[0].id).toBeTruthy();
	});

	it('returns cleaned text without tool call markers', () => {
		const text =
			'Let me update that.\n[TOOL_CALL]{"name":"update_note","args":{"body":"new"}}[/TOOL_CALL]';
		const result = parseSonarToolCalls(text);
		expect(result.cleanText).toBe('Let me update that.');
	});

	it('returns empty tool calls when no markers present', () => {
		const text = 'Just a regular answer with no tools needed.';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls).toEqual([]);
		expect(result.cleanText).toBe(text);
	});

	it('extracts multiple tool calls', () => {
		const text =
			'Doing both.\n[TOOL_CALL]{"name":"search_notes","args":{"query":"meeting"}}[/TOOL_CALL]\n[TOOL_CALL]{"name":"list_notebooks","args":{}}[/TOOL_CALL]';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls).toHaveLength(2);
		expect(result.toolCalls[0].name).toBe('search_notes');
		expect(result.toolCalls[1].name).toBe('list_notebooks');
	});

	it('parses tool call with name but no args, defaulting args to empty object', () => {
		const text = '[TOOL_CALL]{"name":"update_note"}[/TOOL_CALL]';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].name).toBe('update_note');
		expect(result.toolCalls[0].args).toEqual({});
		expect(result.cleanText).toBe('');
	});

	it('strips closed markers with malformed JSON (no tool call extracted)', () => {
		const text =
			'Trying.\n[TOOL_CALL]{"name":"update_note","args":{"body":"text with "bad quotes" inside"}}[/TOOL_CALL]';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls).toEqual([]);
		expect(result.cleanText).toBe('Trying.');
	});

	it('strips closed markers with completely unparseable content', () => {
		const text = 'Trying.\n[TOOL_CALL]not valid json at all[/TOOL_CALL]';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls).toEqual([]);
		expect(result.cleanText).toBe('Trying.');
	});

	it('strips unclosed TOOL_CALL marker (truncated response)', () => {
		const text = '[TOOL_CALL]{"name":"update_note","args":{"body":"1. item one\\n2. item two';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls).toEqual([]);
		expect(result.cleanText).toBe('');
	});

	it('preserves text before unclosed TOOL_CALL marker', () => {
		const text =
			'Let me update that.\n[TOOL_CALL]{"name":"update_note","args":{"body":"very long content that gets truncated';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls).toEqual([]);
		expect(result.cleanText).toBe('Let me update that.');
	});

	it('handles tool call with multiline args', () => {
		const text =
			'[TOOL_CALL]{"name":"update_note","args":{"body":"line1\\nline2\\nline3"}}[/TOOL_CALL]';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].args.body).toBe('line1\nline2\nline3');
	});

	it('generates unique IDs for each tool call', () => {
		const text =
			'[TOOL_CALL]{"name":"a","args":{}}[/TOOL_CALL]\n[TOOL_CALL]{"name":"b","args":{}}[/TOOL_CALL]';
		const result = parseSonarToolCalls(text);
		expect(result.toolCalls[0].id).not.toBe(result.toolCalls[1].id);
	});

	it('trims whitespace from cleaned text', () => {
		const text = '  Some text  \n[TOOL_CALL]{"name":"a","args":{}}[/TOOL_CALL]\n  ';
		const result = parseSonarToolCalls(text);
		expect(result.cleanText).toBe('Some text');
	});
});

describe('buildSonarToolCallPrompt', () => {
	const mockTools: PerplexityTool[] = [
		{
			type: 'function',
			name: 'update_note',
			description: 'Update a note',
			parameters: {
				type: 'object',
				properties: {
					noteId: { type: 'string', description: 'Note ID' },
					body: { type: 'string', description: 'New body' },
				},
			},
		},
		{
			type: 'function',
			name: 'search_notes',
			description: 'Search notes',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Search query' },
				},
				required: ['query'],
			},
		},
	];

	it('includes tool call format markers', () => {
		const prompt = buildSonarToolCallPrompt(mockTools);
		expect(prompt).toContain('[TOOL_CALL]');
		expect(prompt).toContain('[/TOOL_CALL]');
	});

	it('includes tool names and descriptions', () => {
		const prompt = buildSonarToolCallPrompt(mockTools);
		expect(prompt).toContain('update_note');
		expect(prompt).toContain('Update a note');
		expect(prompt).toContain('search_notes');
		expect(prompt).toContain('Search notes');
	});

	it('includes parameter details', () => {
		const prompt = buildSonarToolCallPrompt(mockTools);
		expect(prompt).toContain('noteId');
		expect(prompt).toContain('body');
		expect(prompt).toContain('query');
	});

	it('returns empty string when no tools provided', () => {
		const prompt = buildSonarToolCallPrompt([]);
		expect(prompt).toBe('');
	});
});
