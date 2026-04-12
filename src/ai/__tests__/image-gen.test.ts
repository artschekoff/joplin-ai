import * as https from 'https';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import {
	createImageTask,
	pollTaskResult,
	generateImage,
	ImageGenOptions,
	resolveAspectRatio,
	MODEL_CONFIGS,
	downloadImageToFile,
} from '../image-gen';

jest.mock('https');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createMockResponse = (body: string): any => {
	const res = new EventEmitter();
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

describe('createImageTask', () => {
	it('sends POST to createTask endpoint for market models', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_abc' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask('kie-key-123', {
			prompt: 'A sunset over mountains',
			model: 'gpt-image/1.5-text-to-image',
		});

		expect(taskId).toBe('task_abc');
		expect(mockedRequest).toHaveBeenCalledTimes(1);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const callOpts = mockedRequest.mock.calls[0][0] as any;
		expect(callOpts.hostname).toBe('api.kie.ai');
		expect(callOpts.path).toBe('/api/v1/jobs/createTask');
		expect(callOpts.method).toBe('POST');
	});

	it('includes model and input in request body for market models', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_1' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('kie-key', {
			prompt: 'A cat in space',
			model: 'gpt-image/1.5-text-to-image',
			aspectRatio: '3:2',
			quality: 'high',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.model).toBe('gpt-image/1.5-text-to-image');
		expect(parsed.input.prompt).toBe('A cat in space');
		expect(parsed.input.aspect_ratio).toBe('3:2');
		expect(parsed.input.quality).toBe('high');
	});

	it('uses default aspect ratio and quality when not specified', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_2' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('kie-key', {
			prompt: 'A dog',
			model: 'gpt-image/1.5-text-to-image',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.aspect_ratio).toBe('1:1');
		expect(parsed.input.quality).toBe('medium');
	});

	it('sends POST to dedicated 4o endpoint for gpt4o-image model', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_4o' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask('kie-key', {
			prompt: 'A futuristic city',
			model: 'gpt4o-image',
			aspectRatio: '2:3',
		});

		expect(taskId).toBe('task_4o');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const callOpts = mockedRequest.mock.calls[0][0] as any;
		expect(callOpts.path).toBe('/api/v1/gpt4o-image/generate');
	});

	it('uses prompt and size in 4o request body', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_4o2' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('kie-key', {
			prompt: 'A robot',
			model: 'gpt4o-image',
			aspectRatio: '3:2',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.prompt).toBe('A robot');
		expect(parsed.size).toBe('3:2');
	});

	it('prepends style to prompt when style is provided', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_s' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('kie-key', {
			prompt: 'A castle on a hill',
			model: 'gpt-image/1.5-text-to-image',
			style: 'watercolor painting',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.prompt).toContain('watercolor painting');
		expect(parsed.input.prompt).toContain('A castle on a hill');
	});

	it('includes Bearer token in authorization header', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_auth' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('my-secret-key', {
			prompt: 'test',
			model: 'gpt-image/1.5-text-to-image',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const callOpts = mockedRequest.mock.calls[0][0] as any;
		expect(callOpts.headers.Authorization).toBe('Bearer my-secret-key');
	});

	it('throws when API key is empty', async () => {
		await expect(
			createImageTask('', { prompt: 'test', model: 'gpt-image/1.5-text-to-image' }),
		).rejects.toThrow('Kie.ai API key is required for image generation');
	});

	it('throws when prompt is empty', async () => {
		await expect(
			createImageTask('key', { prompt: '', model: 'gpt-image/1.5-text-to-image' }),
		).rejects.toThrow('Image prompt cannot be empty');
	});

	it('throws when API returns error code', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(JSON.stringify({ code: 402, msg: 'Insufficient Credits' }));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			createImageTask('key', { prompt: 'test', model: 'gpt-image/1.5-text-to-image' }),
		).rejects.toThrow('Insufficient Credits');
	});

	it('throws when response has no taskId', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(JSON.stringify({ code: 200, msg: 'success', data: {} }));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			createImageTask('key', { prompt: 'test', model: 'gpt-image/1.5-text-to-image' }),
		).rejects.toThrow('No task ID returned');
	});

	it('throws on network error after retries are exhausted', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, _callback: any) => {
			const mockReq = createMockRequest();
			process.nextTick(() => mockReq.emit('error', new Error('ECONNREFUSED')));
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			createImageTask(
				'key',
				{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
				{ maxRetries: 0 },
			),
		).rejects.toThrow('ECONNREFUSED');
	});
});

describe('pollTaskResult', () => {
	it('returns image URLs when task state is success', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({
				code: 200,
				data: {
					state: 'success',
					resultJson: JSON.stringify({
						resultUrls: ['https://cdn.kie.ai/image1.png'],
					}),
				},
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const urls = await pollTaskResult('key', 'task_123', { intervalMs: 0 });
		expect(urls).toEqual(['https://cdn.kie.ai/image1.png']);
	});

	it('sends GET request to recordInfo endpoint with taskId', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({
				code: 200,
				data: {
					state: 'success',
					resultJson: JSON.stringify({ resultUrls: ['https://img.png'] }),
				},
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await pollTaskResult('key', 'task_xyz', { intervalMs: 0 });

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const callOpts = mockedRequest.mock.calls[0][0] as any;
		expect(callOpts.hostname).toBe('api.kie.ai');
		expect(callOpts.path).toBe('/api/v1/jobs/recordInfo?taskId=task_xyz');
		expect(callOpts.method).toBe('GET');
	});

	it('polls multiple times until success', async () => {
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callCount++;
			const mockReq = createMockRequest();
			const body =
				callCount < 3
					? JSON.stringify({ code: 200, data: { state: 'generating' } })
					: JSON.stringify({
							code: 200,
							data: {
								state: 'success',
								resultJson: JSON.stringify({ resultUrls: ['https://final.png'] }),
							},
						});
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const urls = await pollTaskResult('key', 'task_poll', { intervalMs: 0 });

		expect(urls).toEqual(['https://final.png']);
		expect(callCount).toBe(3);
	});

	it('handles waiting and queuing states before success', async () => {
		const states = ['waiting', 'queuing', 'generating', 'success'];
		let callIndex = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			const mockReq = createMockRequest();
			const state = states[callIndex++];
			const body =
				state === 'success'
					? JSON.stringify({
							code: 200,
							data: {
								state: 'success',
								resultJson: JSON.stringify({ resultUrls: ['https://done.png'] }),
							},
						})
					: JSON.stringify({ code: 200, data: { state } });
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const urls = await pollTaskResult('key', 'task_wait', { intervalMs: 0 });

		expect(urls).toEqual(['https://done.png']);
		expect(callIndex).toBe(4);
	});

	it('throws when task fails', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({
				code: 200,
				data: { state: 'fail', failCode: '500', failMsg: 'Generation failed' },
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(pollTaskResult('key', 'task_fail', { intervalMs: 0 })).rejects.toThrow(
			'Generation failed',
		);
	});

	it('throws on timeout after max attempts', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			const mockReq = createMockRequest();
			const mockRes = createMockResponse(
				JSON.stringify({ code: 200, data: { state: 'generating' } }),
			);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			pollTaskResult('key', 'task_slow', { intervalMs: 0, maxAttempts: 3 }),
		).rejects.toThrow('timed out');
	});

	it('returns multiple image URLs when available', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({
				code: 200,
				data: {
					state: 'success',
					resultJson: JSON.stringify({
						resultUrls: ['https://img1.png', 'https://img2.png'],
					}),
				},
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const urls = await pollTaskResult('key', 'task_multi', { intervalMs: 0 });
		expect(urls).toEqual(['https://img1.png', 'https://img2.png']);
	});

	it('throws when success state has no resultJson', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(JSON.stringify({ code: 200, data: { state: 'success' } }));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(pollTaskResult('key', 'task_noresult', { intervalMs: 0 })).rejects.toThrow(
			'No image URLs',
		);
	});
});

describe('createImageTask — retry on transient errors', () => {
	const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
	const errorSpy = jest.spyOn(console, 'error').mockImplementation();

	afterEach(() => {
		warnSpy.mockClear();
		errorSpy.mockClear();
	});

	afterAll(() => {
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it('logs a warning on each retry attempt', async () => {
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callCount++;
			const mockReq = createMockRequest();
			const body =
				callCount <= 2
					? JSON.stringify({ code: 500, msg: 'internal error' })
					: JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_log' } });
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask(
			'kie-key',
			{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
			{ maxRetries: 3, initialDelayMs: 0 },
		);

		expect(warnSpy).toHaveBeenCalledTimes(2);
		expect(warnSpy.mock.calls[0].join(' ')).toMatch(/attempt 1\/4/i);
		expect(warnSpy.mock.calls[1].join(' ')).toMatch(/attempt 2\/4/i);
	});

	it('logs an error when all retries are exhausted', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			const mockReq = createMockRequest();
			const mockRes = createMockResponse(JSON.stringify({ code: 500, msg: 'internal error' }));
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			createImageTask(
				'kie-key',
				{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
				{ maxRetries: 2, initialDelayMs: 0 },
			),
		).rejects.toThrow('internal error');

		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy.mock.calls[0].join(' ')).toMatch(/failed after 3 attempt/i);
	});

	it('logs a warning on network error retry', async () => {
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callCount++;
			const mockReq = createMockRequest();
			if (callCount === 1) {
				process.nextTick(() => mockReq.emit('error', new Error('ECONNRESET')));
			} else {
				const mockRes = createMockResponse(
					JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_wlog' } }),
				);
				callback(mockRes);
			}
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask(
			'kie-key',
			{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
			{ maxRetries: 3, initialDelayMs: 0 },
		);

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0].join(' ')).toMatch(/ECONNRESET/);
	});

	it('does not log warnings or errors on immediate success', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_clean' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask(
			'kie-key',
			{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
			{ maxRetries: 3, initialDelayMs: 0 },
		);

		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('does not log warnings on non-transient errors', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(JSON.stringify({ code: 401, msg: 'Unauthorized' }));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			createImageTask(
				'key',
				{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
				{ maxRetries: 3, initialDelayMs: 0 },
			),
		).rejects.toThrow('Unauthorized');

		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('retries and succeeds when API returns 500 then 200', async () => {
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callCount++;
			const mockReq = createMockRequest();
			const body =
				callCount === 1
					? JSON.stringify({ code: 500, msg: 'internal error, please try again later' })
					: JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_retry' } });
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask(
			'kie-key',
			{ prompt: 'A sunset', model: 'gpt-image/1.5-text-to-image' },
			{ maxRetries: 3, initialDelayMs: 0 },
		);

		expect(taskId).toBe('task_retry');
		expect(callCount).toBe(2);
	});

	it('retries on 503 Service Unavailable and succeeds', async () => {
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callCount++;
			const mockReq = createMockRequest();
			const body =
				callCount === 1
					? JSON.stringify({ code: 503, msg: 'Service temporarily unavailable' })
					: JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_503' } });
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask(
			'kie-key',
			{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
			{ maxRetries: 3, initialDelayMs: 0 },
		);

		expect(taskId).toBe('task_503');
		expect(callCount).toBe(2);
	});

	it('retries on network error (ECONNRESET) and succeeds', async () => {
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callCount++;
			const mockReq = createMockRequest();
			if (callCount === 1) {
				process.nextTick(() => mockReq.emit('error', new Error('ECONNRESET')));
			} else {
				const mockRes = createMockResponse(
					JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_net' } }),
				);
				callback(mockRes);
			}
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask(
			'kie-key',
			{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
			{ maxRetries: 3, initialDelayMs: 0 },
		);

		expect(taskId).toBe('task_net');
		expect(callCount).toBe(2);
	});

	it('gives up after max retries on persistent server errors', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			const mockReq = createMockRequest();
			const mockRes = createMockResponse(
				JSON.stringify({ code: 500, msg: 'internal error, please try again later' }),
			);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			createImageTask(
				'kie-key',
				{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
				{ maxRetries: 3, initialDelayMs: 0 },
			),
		).rejects.toThrow('internal error');

		expect(mockedRequest).toHaveBeenCalledTimes(4);
	});

	it('does NOT retry on 401 Unauthorized', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(JSON.stringify({ code: 401, msg: 'Unauthorized' }));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			createImageTask(
				'bad-key',
				{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
				{ maxRetries: 3, initialDelayMs: 0 },
			),
		).rejects.toThrow('Unauthorized');

		expect(mockedRequest).toHaveBeenCalledTimes(1);
	});

	it('does NOT retry on 402 Insufficient Credits', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(JSON.stringify({ code: 402, msg: 'Insufficient Credits' }));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			createImageTask(
				'key',
				{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
				{ maxRetries: 3, initialDelayMs: 0 },
			),
		).rejects.toThrow('Insufficient Credits');

		expect(mockedRequest).toHaveBeenCalledTimes(1);
	});

	it('recovers after two consecutive transient failures', async () => {
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callCount++;
			const mockReq = createMockRequest();
			const body =
				callCount <= 2
					? JSON.stringify({ code: 500, msg: 'internal error' })
					: JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_2fail' } });
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask(
			'kie-key',
			{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
			{ maxRetries: 3, initialDelayMs: 0 },
		);

		expect(taskId).toBe('task_2fail');
		expect(callCount).toBe(3);
	});

	it('uses default retry options when none provided (no retry on existing behavior)', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_default' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask('kie-key', {
			prompt: 'test',
			model: 'gpt-image/1.5-text-to-image',
		});

		expect(taskId).toBe('task_default');
		expect(mockedRequest).toHaveBeenCalledTimes(1);
	});
});

describe('model configuration', () => {
	it('exports MODEL_CONFIGS with gpt-image/1.5-text-to-image', async () => {
		const { MODEL_CONFIGS } = await import('../image-gen');
		const cfg = MODEL_CONFIGS['gpt-image/1.5-text-to-image'];
		expect(cfg).toBeDefined();
		expect(cfg.sizeFieldName).toBe('aspect_ratio');
		expect(cfg.allowedRatios).toEqual(['1:1', '2:3', '3:2']);
		expect(cfg.endpoint).toBe('market');
		expect(cfg.supportsQuality).toBe(true);
	});

	it('exports MODEL_CONFIGS with gpt4o-image', async () => {
		const { MODEL_CONFIGS } = await import('../image-gen');
		const cfg = MODEL_CONFIGS['gpt4o-image'];
		expect(cfg).toBeDefined();
		expect(cfg.sizeFieldName).toBe('size');
		expect(cfg.allowedRatios).toEqual(['1:1', '3:2', '2:3']);
		expect(cfg.endpoint).toBe('4o');
	});

	it('exports MODEL_CONFIGS with nano-banana-pro', async () => {
		const { MODEL_CONFIGS } = await import('../image-gen');
		const cfg = MODEL_CONFIGS['nano-banana-pro'];
		expect(cfg).toBeDefined();
		expect(cfg.sizeFieldName).toBe('aspect_ratio');
		expect(cfg.allowedRatios).toContain('1:1');
		expect(cfg.allowedRatios).toContain('16:9');
		expect(cfg.allowedRatios).toContain('9:16');
		expect(cfg.allowedRatios).toContain('4:3');
		expect(cfg.allowedRatios).toContain('3:4');
		expect(cfg.allowedRatios).toContain('21:9');
		expect(cfg.allowedRatios).toContain('auto');
		expect(cfg.defaultRatio).toBe('1:1');
		expect(cfg.endpoint).toBe('market');
		expect(cfg.supportsQuality).toBeFalsy();
	});

	it('exports MODEL_CONFIGS with nano-banana-2', async () => {
		const { MODEL_CONFIGS } = await import('../image-gen');
		const cfg = MODEL_CONFIGS['nano-banana-2'];
		expect(cfg).toBeDefined();
		expect(cfg.sizeFieldName).toBe('aspect_ratio');
		expect(cfg.defaultRatio).toBe('auto');
		expect(cfg.allowedRatios).toContain('1:1');
		expect(cfg.allowedRatios).toContain('1:4');
		expect(cfg.allowedRatios).toContain('1:8');
		expect(cfg.allowedRatios).toContain('4:1');
		expect(cfg.allowedRatios).toContain('8:1');
		expect(cfg.allowedRatios).toContain('16:9');
		expect(cfg.allowedRatios).toContain('9:16');
		expect(cfg.allowedRatios).toContain('21:9');
		expect(cfg.allowedRatios).toContain('auto');
		expect(cfg.endpoint).toBe('market');
		expect(cfg.supportsQuality).toBeFalsy();
	});
});

describe('aspect ratio resolution', () => {
	it('resolves unsupported ratio to nearest valid ratio for gpt-image/1.5', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_resolved' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask('key', {
			prompt: 'test',
			model: 'gpt-image/1.5-text-to-image',
			aspectRatio: '4:3',
		});
		expect(taskId).toBe('task_resolved');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.aspect_ratio).toBe('3:2');
	});

	it('resolves 16:9 to 3:2 for gpt-image/1.5 (closest landscape)', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_16_9' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'test',
			model: 'gpt-image/1.5-text-to-image',
			aspectRatio: '16:9',
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.aspect_ratio).toBe('3:2');
	});

	it('resolves 9:16 to 2:3 for gpt-image/1.5 (closest portrait)', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_9_16' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'test',
			model: 'gpt-image/1.5-text-to-image',
			aspectRatio: '9:16',
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.aspect_ratio).toBe('2:3');
	});

	it('resolves 4:3 to nearest valid ratio for gpt4o-image', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_4o_43' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask('key', {
			prompt: 'test',
			model: 'gpt4o-image',
			aspectRatio: '4:3',
		});
		expect(taskId).toBe('task_4o_43');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.size).toBe('3:2');
	});

	it('keeps valid ratio unchanged', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_valid' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'test',
			model: 'gpt-image/1.5-text-to-image',
			aspectRatio: '2:3',
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.aspect_ratio).toBe('2:3');
	});

	it('allows 16:9 for nano-banana-pro', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nbp' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask('key', {
			prompt: 'A wide landscape',
			model: 'nano-banana-pro',
			aspectRatio: '16:9',
		});
		expect(taskId).toBe('task_nbp');
	});

	it('falls back to default ratio when none specified', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_def' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'test',
			model: 'nano-banana-pro',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.aspect_ratio).toBe('1:1');
	});

	it('allows ultra-wide ratios for nano-banana-2', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nb2_uw' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask('key', {
			prompt: 'A panoramic view',
			model: 'nano-banana-2',
			aspectRatio: '8:1',
		});
		expect(taskId).toBe('task_nb2_uw');
	});

	it('uses auto as default ratio for nano-banana-2', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nb2_auto' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'test',
			model: 'nano-banana-2',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.aspect_ratio).toBe('auto');
	});
});

describe('nano-banana-pro body format', () => {
	it('sends POST to createTask endpoint for nano-banana-pro', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nbp1' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask('key', {
			prompt: 'A hero banana',
			model: 'nano-banana-pro',
		});

		expect(taskId).toBe('task_nbp1');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const callOpts = mockedRequest.mock.calls[0][0] as any;
		expect(callOpts.path).toBe('/api/v1/jobs/createTask');
	});

	it('does NOT send quality field for nano-banana-pro', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nbp2' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'test',
			model: 'nano-banana-pro',
			quality: 'high',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.quality).toBeUndefined();
	});

	it('includes aspect_ratio in input for nano-banana-pro', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nbp3' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'test',
			model: 'nano-banana-pro',
			aspectRatio: '4:3',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.model).toBe('nano-banana-pro');
		expect(parsed.input.aspect_ratio).toBe('4:3');
		expect(parsed.input.prompt).toBe('test');
	});

	it('prepends style to prompt for nano-banana-pro', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nbp4' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'A sunset',
			model: 'nano-banana-pro',
			style: 'oil painting',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.prompt).toContain('oil painting');
		expect(parsed.input.prompt).toContain('A sunset');
	});
});

describe('nano-banana-2 body format', () => {
	it('sends POST to createTask endpoint for nano-banana-2', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nb2_1' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const taskId = await createImageTask('key', {
			prompt: 'A comic poster',
			model: 'nano-banana-2',
		});

		expect(taskId).toBe('task_nb2_1');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const callOpts = mockedRequest.mock.calls[0][0] as any;
		expect(callOpts.path).toBe('/api/v1/jobs/createTask');
	});

	it('does NOT send quality field for nano-banana-2', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nb2_2' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'test',
			model: 'nano-banana-2',
			quality: 'high',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.input.quality).toBeUndefined();
	});

	it('includes model and aspect_ratio in body for nano-banana-2', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_nb2_3' } }),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await createImageTask('key', {
			prompt: 'A 4K landscape',
			model: 'nano-banana-2',
			aspectRatio: '16:9',
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const writtenBody = (mockReq as any).write.mock.calls[0][0];
		const parsed = JSON.parse(writtenBody);
		expect(parsed.model).toBe('nano-banana-2');
		expect(parsed.input.aspect_ratio).toBe('16:9');
		expect(parsed.input.prompt).toBe('A 4K landscape');
	});
});

describe('resolveAspectRatio', () => {
	it('returns the same ratio when it is already valid', () => {
		const config = MODEL_CONFIGS['gpt-image/1.5-text-to-image'];
		expect(resolveAspectRatio('1:1', config)).toBe('1:1');
		expect(resolveAspectRatio('2:3', config)).toBe('2:3');
		expect(resolveAspectRatio('3:2', config)).toBe('3:2');
	});

	it('maps 4:3 to 3:2 for gpt-image/1.5 (closest by numeric ratio)', () => {
		const config = MODEL_CONFIGS['gpt-image/1.5-text-to-image'];
		expect(resolveAspectRatio('4:3', config)).toBe('3:2');
	});

	it('maps 16:9 to 3:2 for gpt-image/1.5', () => {
		const config = MODEL_CONFIGS['gpt-image/1.5-text-to-image'];
		expect(resolveAspectRatio('16:9', config)).toBe('3:2');
	});

	it('maps 9:16 to 2:3 for gpt-image/1.5', () => {
		const config = MODEL_CONFIGS['gpt-image/1.5-text-to-image'];
		expect(resolveAspectRatio('9:16', config)).toBe('2:3');
	});

	it('maps 3:4 to 2:3 for gpt-image/1.5', () => {
		const config = MODEL_CONFIGS['gpt-image/1.5-text-to-image'];
		expect(resolveAspectRatio('3:4', config)).toBe('2:3');
	});

	it('maps 21:9 to 3:2 for gpt4o-image', () => {
		const config = MODEL_CONFIGS['gpt4o-image'];
		expect(resolveAspectRatio('21:9', config)).toBe('3:2');
	});

	it('returns valid ratio unchanged for nano-banana-pro', () => {
		const config = MODEL_CONFIGS['nano-banana-pro'];
		expect(resolveAspectRatio('4:3', config)).toBe('4:3');
		expect(resolveAspectRatio('16:9', config)).toBe('16:9');
	});

	it('excludes auto from numeric comparison', () => {
		const config = MODEL_CONFIGS['nano-banana-2'];
		expect(resolveAspectRatio('auto', config)).toBe('auto');
	});

	it('falls back to defaultRatio for completely unparseable ratio', () => {
		const config = MODEL_CONFIGS['gpt-image/1.5-text-to-image'];
		expect(resolveAspectRatio('invalid', config)).toBe('1:1');
	});
});

jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('downloadImageToFile', () => {
	beforeEach(() => {
		mockedFs.mkdtempSync.mockReturnValue('/tmp/joplin-img-abc123');
		mockedFs.writeFileSync.mockImplementation(() => undefined);
		mockedFs.existsSync.mockReturnValue(true);
		mockedFs.unlinkSync.mockImplementation(() => undefined);
		mockedFs.rmdirSync.mockImplementation(() => undefined);
	});

	it('downloads image data and writes to a temp file', async () => {
		const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const mockReq = createMockRequest();
		const mockRes = new EventEmitter();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).statusCode = 200;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).headers = { 'content-type': 'image/png' };
		process.nextTick(() => {
			mockRes.emit('data', imageData);
			mockRes.emit('end');
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const result = await downloadImageToFile('https://cdn.kie.ai/image.png');

		expect(result.filePath).toMatch(/joplin-img/);
		expect(result.filePath).toMatch(/\.png$/);
		expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
			expect.stringMatching(/\.png$/),
			expect.any(Buffer),
		);
	});

	it('derives filename from URL path', async () => {
		const imageData = Buffer.from([0xff, 0xd8, 0xff]);
		const mockReq = createMockRequest();
		const mockRes = new EventEmitter();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).statusCode = 200;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).headers = { 'content-type': 'image/jpeg' };
		process.nextTick(() => {
			mockRes.emit('data', imageData);
			mockRes.emit('end');
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const result = await downloadImageToFile('https://cdn.kie.ai/photos/sunset.jpg');

		expect(result.filename).toBe('sunset.jpg');
	});

	it('uses fallback filename when URL has no extension', async () => {
		const imageData = Buffer.from([0x89, 0x50]);
		const mockReq = createMockRequest();
		const mockRes = new EventEmitter();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).statusCode = 200;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).headers = { 'content-type': 'image/png' };
		process.nextTick(() => {
			mockRes.emit('data', imageData);
			mockRes.emit('end');
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const result = await downloadImageToFile('https://cdn.kie.ai/image');

		expect(result.filename).toMatch(/^generated-image.*\.png$/);
	});

	it('returns correct mime type from content-type header', async () => {
		const imageData = Buffer.from([0x89, 0x50]);
		const mockReq = createMockRequest();
		const mockRes = new EventEmitter();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).statusCode = 200;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).headers = { 'content-type': 'image/webp' };
		process.nextTick(() => {
			mockRes.emit('data', imageData);
			mockRes.emit('end');
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const result = await downloadImageToFile('https://cdn.kie.ai/image.webp');

		expect(result.mimeType).toBe('image/webp');
	});

	it('follows HTTP redirects (301/302)', async () => {
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((opts: any, callback: any) => {
			callCount++;
			const mockReq = createMockRequest();
			if (callCount === 1) {
				const redirectRes = new EventEmitter();
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(redirectRes as any).statusCode = 302;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(redirectRes as any).headers = { location: 'https://cdn2.kie.ai/final.png' };
				process.nextTick(() => {
					redirectRes.emit('data', Buffer.alloc(0));
					redirectRes.emit('end');
				});
				callback(redirectRes);
			} else {
				const finalRes = new EventEmitter();
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(finalRes as any).statusCode = 200;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(finalRes as any).headers = { 'content-type': 'image/png' };
				process.nextTick(() => {
					finalRes.emit('data', Buffer.from([0x89, 0x50]));
					finalRes.emit('end');
				});
				callback(finalRes);
			}
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const result = await downloadImageToFile('https://cdn.kie.ai/redirect-image');

		expect(callCount).toBe(2);
		expect(result.filePath).toBeDefined();
	});

	it('throws on HTTP error status', async () => {
		const mockReq = createMockRequest();
		const mockRes = new EventEmitter();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).statusCode = 404;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(mockRes as any).headers = {};
		process.nextTick(() => {
			mockRes.emit('data', Buffer.from('Not Found'));
			mockRes.emit('end');
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(downloadImageToFile('https://cdn.kie.ai/missing.png')).rejects.toThrow(/404/);
	});

	it('throws on network error', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, _callback: any) => {
			const mockReq = createMockRequest();
			process.nextTick(() => mockReq.emit('error', new Error('ECONNREFUSED')));
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(downloadImageToFile('https://cdn.kie.ai/image.png')).rejects.toThrow(
			'ECONNREFUSED',
		);
	});
});

describe('generateImage', () => {
	it('creates a task and polls until success', async () => {
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((opts: any, callback: any) => {
			callCount++;
			const mockReq = createMockRequest();
			const body =
				opts.method === 'POST'
					? JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_gen1' } })
					: JSON.stringify({
							code: 200,
							data: {
								state: 'success',
								resultJson: JSON.stringify({
									resultUrls: ['https://cdn.kie.ai/result.png'],
								}),
							},
						});
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const result = await generateImage(
			'kie-key',
			{ prompt: 'A beautiful landscape', model: 'gpt-image/1.5-text-to-image' },
			{ intervalMs: 0 },
		);

		expect(result.taskId).toBe('task_gen1');
		expect(result.imageUrls).toEqual(['https://cdn.kie.ai/result.png']);
		expect(callCount).toBe(2);
	});

	it('passes options through to createImageTask', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((opts: any, callback: any) => {
			const mockReq = createMockRequest();
			const body =
				opts.method === 'POST'
					? JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_opts' } })
					: JSON.stringify({
							code: 200,
							data: {
								state: 'success',
								resultJson: JSON.stringify({ resultUrls: ['https://r.png'] }),
							},
						});
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const options: ImageGenOptions = {
			prompt: 'A dragon',
			model: 'gpt4o-image',
			aspectRatio: '2:3',
			style: 'anime',
		};
		await generateImage('key', options, { intervalMs: 0 });

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const postCall = mockedRequest.mock.calls.find((c) => (c[0] as any).method === 'POST');
		expect(postCall).toBeDefined();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((postCall![0] as any).path).toBe('/api/v1/gpt4o-image/generate');
	});

	it('propagates createTask errors', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(JSON.stringify({ code: 401, msg: 'Unauthorized' }));
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			generateImage(
				'bad-key',
				{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
				{ intervalMs: 0 },
			),
		).rejects.toThrow('Unauthorized');
	});

	it('propagates polling errors', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((opts: any, callback: any) => {
			const mockReq = createMockRequest();
			const body =
				opts.method === 'POST'
					? JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_err' } })
					: JSON.stringify({
							code: 200,
							data: { state: 'fail', failMsg: 'Content policy violation' },
						});
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(
			generateImage(
				'key',
				{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
				{ intervalMs: 0 },
			),
		).rejects.toThrow('Content policy violation');
	});
});

describe('pollTaskResult — onProgress callback', () => {
	it('calls onProgress on each poll attempt with attempt index, maxAttempts, and state', async () => {
		const states = ['generating', 'generating', 'success'];
		let callIndex = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			const mockReq = createMockRequest();
			const state = states[callIndex++];
			const body =
				state === 'success'
					? JSON.stringify({
							code: 200,
							data: {
								state: 'success',
								resultJson: JSON.stringify({ resultUrls: ['https://done.png'] }),
							},
						})
					: JSON.stringify({ code: 200, data: { state } });
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const onProgress = jest.fn();
		await pollTaskResult('key', 'task_prog', { intervalMs: 0, maxAttempts: 10, onProgress });

		expect(onProgress).toHaveBeenCalledTimes(3);
		expect(onProgress).toHaveBeenNthCalledWith(1, {
			attempt: 0,
			maxAttempts: 10,
			state: 'generating',
		});
		expect(onProgress).toHaveBeenNthCalledWith(2, {
			attempt: 1,
			maxAttempts: 10,
			state: 'generating',
		});
		expect(onProgress).toHaveBeenNthCalledWith(3, {
			attempt: 2,
			maxAttempts: 10,
			state: 'success',
		});
	});

	it('does not throw when onProgress is not provided', async () => {
		const mockReq = createMockRequest();
		const mockRes = createMockResponse(
			JSON.stringify({
				code: 200,
				data: {
					state: 'success',
					resultJson: JSON.stringify({ resultUrls: ['https://ok.png'] }),
				},
			}),
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		await expect(pollTaskResult('key', 'task_noprog', { intervalMs: 0 })).resolves.toEqual([
			'https://ok.png',
		]);
	});

	it('reports waiting and queuing states in onProgress', async () => {
		const states = ['waiting', 'queuing', 'generating', 'success'];
		let callIndex = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((_opts: any, callback: any) => {
			const mockReq = createMockRequest();
			const state = states[callIndex++];
			const body =
				state === 'success'
					? JSON.stringify({
							code: 200,
							data: {
								state: 'success',
								resultJson: JSON.stringify({ resultUrls: ['https://fin.png'] }),
							},
						})
					: JSON.stringify({ code: 200, data: { state } });
			const mockRes = createMockResponse(body);
			callback(mockRes);
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const onProgress = jest.fn();
		await pollTaskResult('key', 'task_states', { intervalMs: 0, maxAttempts: 60, onProgress });

		expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ state: 'waiting' }));
		expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ state: 'queuing' }));
		expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ state: 'generating' }));
		expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ state: 'success' }));
	});
});

describe('generateImage — onProgress forwarding', () => {
	it('forwards onProgress to pollTaskResult', async () => {
		let pollCallCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockedRequest.mockImplementation((opts: any, callback: any) => {
			const mockReq = createMockRequest();
			if (opts.method === 'POST') {
				const mockRes = createMockResponse(
					JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_fwd' } }),
				);
				callback(mockRes);
			} else {
				pollCallCount++;
				const body =
					pollCallCount < 2
						? JSON.stringify({ code: 200, data: { state: 'generating' } })
						: JSON.stringify({
								code: 200,
								data: {
									state: 'success',
									resultJson: JSON.stringify({ resultUrls: ['https://fwd.png'] }),
								},
							});
				const mockRes = createMockResponse(body);
				callback(mockRes);
			}
			return mockReq as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		});

		const onProgress = jest.fn();
		await generateImage(
			'key',
			{ prompt: 'test', model: 'gpt-image/1.5-text-to-image' },
			{ intervalMs: 0, onProgress },
		);

		expect(onProgress).toHaveBeenCalled();
		expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ state: 'generating' }));
	});
});
