import * as https from 'https';
import { StringDecoder } from 'string_decoder';
import { AIProviderResponse, AIToolCall, TokenUsage } from './types';
import { ClaudeTool } from './tools';

const makeRequest = (apiKey: string, body: string): Promise<Record<string, unknown>> =>
	new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: 'api.anthropic.com',
				path: '/v1/messages',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
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
							reject(new Error(parsed.error.message || 'Claude API error'));
							return;
						}
						resolve(parsed);
					} catch (e) {
						reject(new Error(`Failed to parse Claude response: ${e.message}`));
					}
				});
			},
		);

		req.on('error', (e: Error) => reject(new Error(`Claude request failed: ${e.message}`)));
		req.write(body);
		req.end();
	});

export const sendClaudeMessages = async (
	apiKey: string,
	model: string,
	system: string,
	messages: Array<{ role: string; content: unknown }>,
	tools?: ClaudeTool[],
): Promise<AIProviderResponse> => {
	const requestBody: Record<string, unknown> = {
		model,
		max_tokens: 4096,
		system,
		messages,
	};
	if (tools?.length) {
		requestBody.tools = tools;
	}

	const parsed = await makeRequest(apiKey, JSON.stringify(requestBody));
	const contentBlocks = (parsed.content || []) as Array<{
		type: string;
		text?: string;
		id?: string;
		name?: string;
		input?: Record<string, unknown>;
	}>;

	const textParts = contentBlocks.filter((b) => b.type === 'text').map((b) => b.text ?? '');
	const textContent = textParts.length > 0 ? textParts.join('\n') : null;

	const toolCalls: AIToolCall[] = contentBlocks
		.filter((b) => b.type === 'tool_use')
		.map((b) => ({
			id: b.id!,
			name: b.name!,
			args: b.input ?? {},
		}));

	return {
		textContent,
		toolCalls,
		finishReason: (parsed.stop_reason as string) || 'end_turn',
		rawAssistantMessage: { role: 'assistant', content: contentBlocks },
	};
};

export const callClaude = async (
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
): Promise<string> => {
	const response = await sendClaudeMessages(apiKey, model, systemPrompt, [
		{ role: 'user', content: userPrompt },
	]);
	if (!response.textContent) {
		throw new Error('Empty response from Claude');
	}
	return response.textContent;
};

interface ClaudeStreamBlock {
	type: 'text' | 'tool_use';
	id?: string;
	name?: string;
	text?: string;
	inputJson?: string;
}

const makeClaudeStreamRequest = (apiKey: string, body: string): Promise<NodeJS.ReadableStream> =>
	new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: 'api.anthropic.com',
				path: '/v1/messages',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
				},
			},
			(res) => {
				resolve(res);
			},
		);
		req.on('error', (e: Error) => reject(new Error(`Claude request failed: ${e.message}`)));
		req.write(body);
		req.end();
	});

export const streamClaudeMessages = async (
	apiKey: string,
	model: string,
	system: string,
	messages: Array<{ role: string; content: unknown }>,
	onChunk: (text: string) => void,
	tools?: ClaudeTool[],
): Promise<AIProviderResponse> => {
	const requestBody: Record<string, unknown> = {
		model,
		max_tokens: 4096,
		system,
		messages,
		stream: true,
	};
	if (tools?.length) {
		requestBody.tools = tools;
	}
	const stream = await makeClaudeStreamRequest(apiKey, JSON.stringify(requestBody));
	return new Promise((resolve, reject) => {
		const decoder = new StringDecoder('utf8');
		let buffer = '';
		let fullText = '';
		let finishReason = 'end_turn';
		let inputTokens = 0;
		let outputTokens = 0;
		const blocks: ClaudeStreamBlock[] = [];
		let currentBlockIndex = -1;

		stream.on('data', (chunk: Buffer) => {
			buffer += decoder.write(chunk);
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.startsWith('data: ')) {
					const payload = trimmed.slice(6);
					try {
						const parsed = JSON.parse(payload);
						if (parsed.error) {
							reject(new Error(parsed.error.message || 'Claude streaming error'));
							return;
						}
						if (parsed.type === 'message_start' && parsed.message?.usage) {
							inputTokens = parsed.message.usage.input_tokens ?? 0;
						}
						if (parsed.type === 'content_block_start') {
							currentBlockIndex = parsed.index ?? blocks.length;
							const block = parsed.content_block;
							blocks[currentBlockIndex] = {
								type: block.type,
								id: block.id,
								name: block.name,
								text: block.text ?? '',
								inputJson: '',
							};
						}
						if (parsed.type === 'content_block_delta') {
							const idx = parsed.index ?? currentBlockIndex;
							const delta = parsed.delta;
							if (delta?.type === 'text_delta' && delta.text) {
								if (blocks[idx]) {
									blocks[idx].text = (blocks[idx].text ?? '') + delta.text;
								}
								fullText += delta.text;
								onChunk(delta.text);
							}
							if (delta?.type === 'input_json_delta' && delta.partial_json) {
								if (blocks[idx]) {
									blocks[idx].inputJson = (blocks[idx].inputJson ?? '') + delta.partial_json;
								}
							}
						}
						if (parsed.type === 'message_delta') {
							if (parsed.delta?.stop_reason) {
								finishReason = parsed.delta.stop_reason;
							}
							if (parsed.usage?.output_tokens) {
								outputTokens = parsed.usage.output_tokens;
							}
						}
					} catch {
						// skip malformed SSE
					}
				}
			}
		});
		stream.on('end', () => {
			buffer += decoder.end();
			const contentBlocks: Array<{
				type: string;
				text?: string;
				id?: string;
				name?: string;
				input?: Record<string, unknown>;
			}> = [];
			const toolCalls: AIToolCall[] = [];
			for (const block of blocks) {
				if (!block) continue;
				if (block.type === 'text') {
					contentBlocks.push({ type: 'text', text: block.text ?? '' });
				} else if (block.type === 'tool_use') {
					let parsedInput: Record<string, unknown> = {};
					try {
						parsedInput = JSON.parse(block.inputJson ?? '{}');
					} catch {
						/* empty */
					}
					contentBlocks.push({
						type: 'tool_use',
						id: block.id,
						name: block.name,
						input: parsedInput,
					});
					toolCalls.push({
						id: block.id!,
						name: block.name!,
						args: parsedInput,
					});
				}
			}
			const usage: TokenUsage | undefined =
				inputTokens > 0 || outputTokens > 0 ? { inputTokens, outputTokens } : undefined;
			resolve({
				textContent: fullText || null,
				toolCalls,
				finishReason,
				rawAssistantMessage: { role: 'assistant', content: contentBlocks },
				usage,
			});
		});
		stream.on('error', (e: Error) => {
			reject(new Error(`Claude stream error: ${e.message}`));
		});
	});
};
