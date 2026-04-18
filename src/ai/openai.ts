import * as https from 'https';
import { StringDecoder } from 'string_decoder';
import { AIProviderResponse, AIToolCall, TokenUsage } from './types';
import { OpenAITool } from './tools';

/** Models that do not support the `temperature` parameter (OpenAI o-series reasoning models). */
const REASONING_MODELS = new Set(['o3', 'o4-mini', 'codex-mini-latest']);

export const isReasoningModel = (model: string): boolean => REASONING_MODELS.has(model);

interface OpenAIMessage {
	role: string;
	content?: string | null;
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
}

const makeRequest = (apiKey: string, body: string): Promise<Record<string, unknown>> =>
	new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: 'api.openai.com',
				path: '/v1/chat/completions',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
			},
			(res) => {
				const decoder = new StringDecoder('utf8');
				let data = '';
				res.on('data', (chunk: Buffer) => {
					data += decoder.write(chunk);
				});
				res.on('end', () => {
					data += decoder.end();
					try {
						const parsed = JSON.parse(data);
						if (parsed.error) {
							reject(new Error(parsed.error.message || 'OpenAI API error'));
							return;
						}
						resolve(parsed);
					} catch (e) {
						reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
					}
				});
			},
		);

		req.on('error', (e: Error) => reject(new Error(`OpenAI request failed: ${e.message}`)));
		req.write(body);
		req.end();
	});

export const sendOpenAIMessages = async (
	apiKey: string,
	model: string,
	messages: OpenAIMessage[],
	tools?: OpenAITool[],
): Promise<AIProviderResponse> => {
	const requestBody: Record<string, unknown> = {
		model,
		messages,
		...(isReasoningModel(model) ? {} : { temperature: 0.3 }),
	};
	if (tools?.length) {
		requestBody.tools = tools;
	}

	const parsed = await makeRequest(apiKey, JSON.stringify(requestBody));
	const choices = parsed.choices as Array<{
		message: {
			content?: string | null;
			tool_calls?: Array<{
				id: string;
				function: { name: string; arguments: string };
			}>;
		};
		finish_reason: string;
	}>;
	const choice = choices?.[0];
	if (!choice) {
		throw new Error('Empty response from OpenAI');
	}

	const message = choice.message;
	const toolCalls: AIToolCall[] = (message.tool_calls || []).map((tc) => ({
		id: tc.id,
		name: tc.function.name,
		args: JSON.parse(tc.function.arguments),
	}));

	return {
		textContent: message.content ?? null,
		toolCalls,
		finishReason: choice.finish_reason,
		rawAssistantMessage: message,
	};
};

export const callOpenAI = async (
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
): Promise<string> => {
	const response = await sendOpenAIMessages(apiKey, model, [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userPrompt },
	]);
	if (!response.textContent) {
		throw new Error('Empty response from OpenAI');
	}
	return response.textContent;
};

interface StreamingToolCallAccumulator {
	id: string;
	name: string;
	arguments: string;
}

const makeStreamRequest = (apiKey: string, body: string): Promise<NodeJS.ReadableStream> =>
	new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: 'api.openai.com',
				path: '/v1/chat/completions',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
			},
			(res) => {
				resolve(res);
			},
		);
		req.on('error', (e: Error) => reject(new Error(`OpenAI request failed: ${e.message}`)));
		req.write(body);
		req.end();
	});

export const streamOpenAIMessages = async (
	apiKey: string,
	model: string,
	messages: OpenAIMessage[],
	onChunk: (text: string) => void,
	tools?: OpenAITool[],
): Promise<AIProviderResponse> => {
	const requestBody: Record<string, unknown> = {
		model,
		messages,
		stream: true,
		stream_options: { include_usage: true },
		...(isReasoningModel(model) ? {} : { temperature: 0.3 }),
	};
	if (tools?.length) {
		requestBody.tools = tools;
	}
	const stream = await makeStreamRequest(apiKey, JSON.stringify(requestBody));
	return new Promise((resolve, reject) => {
		const decoder = new StringDecoder('utf8');
		let buffer = '';
		let fullText = '';
		let finishReason = 'stop';
		let usage: TokenUsage | undefined;
		const toolAccumulators: Map<number, StreamingToolCallAccumulator> = new Map();

		stream.on('data', (chunk: Buffer) => {
			buffer += decoder.write(chunk);
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || !trimmed.startsWith('data: ')) continue;
				const payload = trimmed.slice(6);
				if (payload === '[DONE]') continue;
				try {
					const parsed = JSON.parse(payload);
					if (parsed.error) {
						reject(new Error(parsed.error.message || 'OpenAI streaming error'));
						return;
					}
					if (parsed.usage) {
						usage = {
							inputTokens: parsed.usage.prompt_tokens ?? 0,
							outputTokens: parsed.usage.completion_tokens ?? 0,
						};
					}
					const choice = parsed.choices?.[0];
					if (!choice) continue;
					if (choice.finish_reason) {
						finishReason = choice.finish_reason;
					}
					const delta = choice.delta;
					if (!delta) continue;
					if (delta.content) {
						fullText += delta.content;
						onChunk(delta.content);
					}
					if (delta.tool_calls) {
						for (const tc of delta.tool_calls) {
							const idx = tc.index ?? 0;
							if (tc.id) {
								toolAccumulators.set(idx, {
									id: tc.id,
									name: tc.function?.name ?? '',
									arguments: tc.function?.arguments ?? '',
								});
							} else {
								const existing = toolAccumulators.get(idx);
								if (existing && tc.function?.arguments) {
									existing.arguments += tc.function.arguments;
								}
							}
						}
					}
				} catch {
					// skip malformed SSE lines
				}
			}
		});
		stream.on('end', () => {
			buffer += decoder.end();
			const toolCalls: AIToolCall[] = [];
			for (const acc of toolAccumulators.values()) {
				try {
					toolCalls.push({
						id: acc.id,
						name: acc.name,
						args: JSON.parse(acc.arguments),
					});
				} catch {
					toolCalls.push({ id: acc.id, name: acc.name, args: {} });
				}
			}
			const rawToolCalls = toolCalls.map((tc) => ({
				id: tc.id,
				type: 'function' as const,
				function: { name: tc.name, arguments: JSON.stringify(tc.args) },
			}));
			resolve({
				textContent: fullText || null,
				toolCalls,
				finishReason,
				rawAssistantMessage: {
					role: 'assistant',
					content: fullText || null,
					...(rawToolCalls.length > 0 ? { tool_calls: rawToolCalls } : {}),
				},
				usage,
			});
		});
		stream.on('error', (e: Error) => {
			reject(new Error(`OpenAI stream error: ${e.message}`));
		});
	});
};
