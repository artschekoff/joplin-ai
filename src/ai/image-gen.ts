import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StringDecoder } from 'string_decoder';
import { msleep, Second } from '@joplin/utils/time';
import logger from '../utils/logger';

export interface ImageGenOptions {
	prompt: string;
	model: string;
	aspectRatio?: string;
	quality?: string;
	style?: string;
}

export interface ImageGenResult {
	taskId: string;
	imageUrls: string[];
}

export interface PollProgress {
	attempt: number;
	maxAttempts: number;
	state: string;
}

export interface PollOptions {
	intervalMs?: number;
	maxAttempts?: number;
	onProgress?: (progress: PollProgress) => void;
}

export interface RetryOptions {
	maxRetries?: number;
	initialDelayMs?: number;
}

const DEFAULT_QUALITY = 'medium';
const DEFAULT_POLL_INTERVAL_MS = 3 * Second;
const DEFAULT_MAX_POLL_ATTEMPTS = 60;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = Second;

const GPT4O_MODEL = 'gpt4o-image';

export interface ModelConfig {
	sizeFieldName: string;
	allowedRatios: string[];
	defaultRatio: string;
	endpoint: 'market' | '4o';
	supportsQuality?: boolean;
}

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
	'gpt-image/1.5-text-to-image': {
		sizeFieldName: 'aspect_ratio',
		allowedRatios: ['1:1', '2:3', '3:2'],
		defaultRatio: '1:1',
		endpoint: 'market',
		supportsQuality: true,
	},
	[GPT4O_MODEL]: {
		sizeFieldName: 'size',
		allowedRatios: ['1:1', '3:2', '2:3'],
		defaultRatio: '1:1',
		endpoint: '4o',
	},
	'nano-banana-pro': {
		sizeFieldName: 'aspect_ratio',
		allowedRatios: [
			'1:1',
			'2:3',
			'3:2',
			'3:4',
			'4:3',
			'4:5',
			'5:4',
			'9:16',
			'16:9',
			'21:9',
			'auto',
		],
		defaultRatio: '1:1',
		endpoint: 'market',
	},
	'nano-banana-2': {
		sizeFieldName: 'aspect_ratio',
		allowedRatios: [
			'1:1',
			'1:4',
			'1:8',
			'2:3',
			'3:2',
			'3:4',
			'4:1',
			'4:3',
			'4:5',
			'5:4',
			'8:1',
			'9:16',
			'16:9',
			'21:9',
			'auto',
		],
		defaultRatio: 'auto',
		endpoint: 'market',
	},
};

class TransientApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TransientApiError';
	}
}

const isTransientStatusCode = (code: number): boolean => code >= 500 && code < 600;

const computeBackoff = (initialDelayMs: number, attempt: number): number =>
	initialDelayMs * Math.pow(2, attempt);

const REQUEST_TIMEOUT_MS = 30_000;

const makeRequest = (
	options: https.RequestOptions,
	body?: string,
): Promise<Record<string, unknown>> =>
	new Promise((resolve, reject) => {
	const req = https.request(options, (res) => {
		const decoder = new StringDecoder('utf8');
		let data = '';
		res.on('data', (chunk: Buffer) => {
			data += decoder.write(chunk);
		});
		res.on('end', () => {
			data += decoder.end();
			const statusCode = res.statusCode ?? 0;
			if (statusCode >= 500 && statusCode < 600) {
				reject(new TransientApiError(`Kie.ai server error: HTTP ${statusCode}`));
				return;
			}
			try {
				resolve(JSON.parse(data));
			} catch (e) {
				reject(
					new Error(
						`Failed to parse Kie.ai response (HTTP ${statusCode}): ${(e as Error).message}`,
					),
				);
			}
		});
		});
		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy();
			reject(new TransientApiError('Kie.ai request timed out'));
		});
		req.on('error', (e: Error) => {
			const wrapped = new TransientApiError(`Kie.ai request failed: ${e.message}`);
			reject(wrapped);
		});
		if (body) req.write(body);
		req.end();
	});

const buildEffectivePrompt = (prompt: string, style?: string): string =>
	style?.trim() ? `${style.trim()} style: ${prompt}` : prompt;

const getModelConfig = (model: string): ModelConfig => {
	const config = MODEL_CONFIGS[model];
	if (!config) {
		throw new Error(`Unknown image generation model: ${model}`);
	}
	return config;
};

const parseRatioValue = (ratio: string): number | null => {
	const parts = ratio.split(':');
	if (parts.length !== 2) return null;
	const w = Number(parts[0]);
	const h = Number(parts[1]);
	if (!Number.isFinite(w) || !Number.isFinite(h) || h === 0) return null;
	return w / h;
};

/** Map an aspect ratio to the closest allowed ratio for the model. Returns the original if already valid. */
export const resolveAspectRatio = (ratio: string, config: ModelConfig): string => {
	if (config.allowedRatios.includes(ratio)) return ratio;
	if (ratio === 'auto' && config.allowedRatios.includes('auto')) return 'auto';
	const target = parseRatioValue(ratio);
	if (target === null) return config.defaultRatio;
	let bestRatio = config.defaultRatio;
	let bestDiff = Infinity;
	for (const candidate of config.allowedRatios) {
		if (candidate === 'auto') continue;
		const val = parseRatioValue(candidate);
		if (val === null) continue;
		const diff = Math.abs(val - target);
		if (diff < bestDiff) {
			bestDiff = diff;
			bestRatio = candidate;
		}
	}
	return bestRatio;
};

const buildRequestBody = (options: ImageGenOptions, config: ModelConfig): string => {
	const effectivePrompt = buildEffectivePrompt(options.prompt, options.style);
	const ratio = options.aspectRatio ?? config.defaultRatio;
	if (config.endpoint === '4o') {
		return JSON.stringify({
			prompt: effectivePrompt,
			[config.sizeFieldName]: ratio,
		});
	}
	const input: Record<string, string> = {
		prompt: effectivePrompt,
		[config.sizeFieldName]: ratio,
	};
	if (config.supportsQuality) {
		input.quality = options.quality ?? DEFAULT_QUALITY;
	}
	return JSON.stringify({ model: options.model, input });
};

/** Create an image generation task on Kie.ai. Returns the task ID. Retries on transient server/network errors. */
export const createImageTask = async (
	apiKey: string,
	options: ImageGenOptions,
	retryOptions?: RetryOptions,
): Promise<string> => {
	if (!apiKey?.trim()) {
		throw new Error('Kie.ai API key is required for image generation');
	}
	if (!options.prompt?.trim()) {
		throw new Error('Image prompt cannot be empty');
	}

	const maxRetries = retryOptions?.maxRetries ?? DEFAULT_MAX_RETRIES;
	const initialDelayMs = retryOptions?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
	const config = getModelConfig(options.model);
	if (options.aspectRatio) {
		const resolved = resolveAspectRatio(options.aspectRatio, config);
		if (resolved !== options.aspectRatio) {
			logger.warn(
				`Aspect ratio "${options.aspectRatio}" is not supported by ${options.model} — using "${resolved}" instead`,
			);
			options = { ...options, aspectRatio: resolved };
		}
	}
	const path =
		config.endpoint === '4o' ? '/api/v1/gpt4o-image/generate' : '/api/v1/jobs/createTask';
	const body = buildRequestBody(options, config);

	const totalAttempts = maxRetries + 1;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const parsed = await makeRequest(
				{
					hostname: 'api.kie.ai',
					path,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${apiKey}`,
					},
				},
				body,
			);

			const code = parsed.code as number;
			if (code !== 200) {
				const msg = (parsed.msg as string) || `Kie.ai API error (code ${code})`;
				if (isTransientStatusCode(code) && attempt < maxRetries) {
					const backoff = computeBackoff(initialDelayMs, attempt);
					logger.warn(
						`Image task creation failed (attempt ${attempt + 1}/${totalAttempts}, code ${code}: ${msg}) — retrying in ${backoff}ms`,
					);
					if (backoff > 0) await msleep(backoff);
					continue;
				}
				if (isTransientStatusCode(code)) {
					logger.error(`Image task creation failed after ${totalAttempts} attempts: ${msg}`);
				}
				throw new Error(msg);
			}

			const data = parsed.data as { taskId?: string } | undefined;
			if (!data?.taskId) {
				throw new Error('No task ID returned from Kie.ai');
			}

			return data.taskId;
		} catch (error) {
			if (error instanceof TransientApiError && attempt < maxRetries) {
				const backoff = computeBackoff(initialDelayMs, attempt);
				logger.warn(
					`Image task creation failed (attempt ${attempt + 1}/${totalAttempts}: ${error.message}) — retrying in ${backoff}ms`,
				);
				if (backoff > 0) await msleep(backoff);
				continue;
			}
			if (error instanceof TransientApiError) {
				logger.error(
					`Image task creation failed after ${totalAttempts} attempts: ${error.message}`,
				);
			}
			throw error;
		}
	}

	throw new Error('Image task creation failed after retries');
};

/** Poll a Kie.ai task until it reaches a terminal state. Returns image URLs. */
export const pollTaskResult = async (
	apiKey: string,
	taskId: string,
	options?: PollOptions,
): Promise<string[]> => {
	const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
	const onProgress = options?.onProgress;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		let parsed: Record<string, unknown>;
		try {
			parsed = await makeRequest({
				hostname: 'api.kie.ai',
				path: `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
				method: 'GET',
				headers: { Authorization: `Bearer ${apiKey}` },
			});
		} catch (error) {
			if (error instanceof TransientApiError && attempt < maxAttempts - 1) {
				logger.warn(`Poll attempt ${attempt + 1} failed: ${error.message} — retrying`);
				if (intervalMs > 0) await msleep(intervalMs);
				continue;
			}
			throw error;
		}

		const data = parsed.data as {
			state?: string;
			resultJson?: string;
			failCode?: string;
			failMsg?: string;
		};

		const state = data?.state ?? 'unknown';
		onProgress?.({ attempt, maxAttempts, state });

		if (state === 'success') {
			if (!data.resultJson) {
				throw new Error('No image URLs in completed task');
			}
			let result: { resultUrls?: string[] };
			try {
				result = JSON.parse(data.resultJson);
			} catch {
				throw new Error('Failed to parse image generation result');
			}
			if (!result.resultUrls?.length) {
				throw new Error('No image URLs in completed task');
			}
			return result.resultUrls;
		}

		if (state === 'fail') {
			throw new Error(data.failMsg || 'Image generation failed');
		}

		if (attempt < maxAttempts - 1 && intervalMs > 0) {
			await msleep(intervalMs);
		}
	}

	throw new Error(`Image generation timed out after ${maxAttempts} attempts`);
};

export interface DownloadResult {
	filePath: string;
	filename: string;
	mimeType: string;
}

const MIME_TO_EXT: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
	'image/gif': '.gif',
};

const MAX_REDIRECTS = 5;
const MAX_IMAGE_DOWNLOAD_SIZE = 50 * 1024 * 1024;

const extractFilename = (url: string, mimeType: string): string => {
	const urlPath = new URL(url).pathname;
	const basename = path.basename(urlPath);
	const ext = path.extname(basename);
	if (ext && basename.length > ext.length) return basename;
	const fallbackExt = MIME_TO_EXT[mimeType] ?? '.png';
	return `generated-image-${Date.now()}${fallbackExt}`;
};

const ALLOWED_IMAGE_HOSTS = new Set(['cdn.kie.ai', 'api.kie.ai']);

const isAllowedImageHost = (hostname: string): boolean =>
	ALLOWED_IMAGE_HOSTS.has(hostname) || hostname.endsWith('.kie.ai');

const downloadUrl = (
	url: string,
	redirectCount: number,
): Promise<{ data: Buffer; mimeType: string; finalUrl: string }> =>
	new Promise((resolve, reject) => {
		const parsedUrl = new URL(url);
		if (!isAllowedImageHost(parsedUrl.hostname)) {
			reject(new Error(`Image download blocked: untrusted host "${parsedUrl.hostname}"`));
			return;
		}
		const req = https.request(
			{
				hostname: parsedUrl.hostname,
				path: parsedUrl.pathname + parsedUrl.search,
				method: 'GET',
				headers: { 'User-Agent': 'JoplinAIPlugin/1.0' },
			},
			(res) => {
				const statusCode = res.statusCode ?? 0;
				if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
					if (redirectCount >= MAX_REDIRECTS) {
						reject(new Error(`Too many redirects downloading image`));
						return;
					}
					const resolvedLocation = new URL(res.headers.location, url).href;
					downloadUrl(resolvedLocation, redirectCount + 1)
						.then(resolve)
						.catch(reject);
					return;
				}
				if (statusCode !== 200) {
					reject(new Error(`Image download failed: HTTP ${statusCode}`));
					return;
				}
				const chunks: Buffer[] = [];
				let totalBytes = 0;
				res.on('data', (chunk: Buffer) => {
					totalBytes += chunk.length;
					if (totalBytes > MAX_IMAGE_DOWNLOAD_SIZE) {
						req.destroy();
						reject(new Error('Image download too large (exceeds 50MB limit)'));
						return;
					}
					chunks.push(chunk);
				});
				res.on('end', () => {
					const contentType = res.headers['content-type'] ?? 'image/png';
					const mimeType = contentType.split(';')[0].trim();
					resolve({ data: Buffer.concat(chunks), mimeType, finalUrl: url });
				});
			},
		);
		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy();
			reject(new Error('Image download timed out'));
		});
		req.on('error', (e: Error) => reject(e));
		req.end();
	});

/** Download an image from a URL to a temporary file. Returns the file path, filename, and MIME type. */
export const downloadImageToFile = async (url: string): Promise<DownloadResult> => {
	const { data, mimeType } = await downloadUrl(url, 0);
	const filename = extractFilename(url, mimeType);
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplin-img-'));
	const filePath = path.join(tmpDir, filename);
	fs.writeFileSync(filePath, data);
	return { filePath, filename, mimeType };
};

/** Generate an image end-to-end: create task, poll until done. */
export const generateImage = async (
	apiKey: string,
	options: ImageGenOptions,
	pollOpts?: PollOptions,
): Promise<ImageGenResult> => {
	const taskId = await createImageTask(apiKey, options);
	const imageUrls = await pollTaskResult(apiKey, taskId, pollOpts);
	return { taskId, imageUrls };
};
