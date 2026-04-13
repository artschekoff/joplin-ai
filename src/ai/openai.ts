import * as https from 'https';
import { StringDecoder } from 'string_decoder';
import { AIProviderResponse, AIToolCall } from './types';
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
