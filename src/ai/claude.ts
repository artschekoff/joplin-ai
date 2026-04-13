import * as https from 'https';
import { StringDecoder } from 'string_decoder';
import { AIProviderResponse, AIToolCall } from './types';
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
