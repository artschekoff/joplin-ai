import * as https from 'https';
import { StringDecoder } from 'string_decoder';
import { AIProviderResponse, AIToolCall } from './types';
import { PerplexityTool } from './tools';

export type PerplexityInputItem = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 60_000;

const makeRequest = (
	apiKey: string,
	path: string,
	body: string,
): Promise<Record<string, unknown>> =>
	new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: 'api.perplexity.ai',
				path,
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
							reject(new Error(parsed.error.message || 'Perplexity API error'));
							return;
						}
						resolve(parsed);
					} catch (e) {
						reject(new Error(`Failed to parse Perplexity response: ${(e as Error).message}`));
					}
				});
			},
		);
		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy();
			reject(new Error('Perplexity request timed out'));
		});
		req.on('error', (e: Error) => reject(new Error(`Perplexity request failed: ${e.message}`)));
		req.write(body);
		req.end();
	});

const AGENT_API_PATH = '/v1/agent';
const SONAR_API_PATH = '/v1/sonar';
const PERPLEXITY_MODEL_PREFIX = 'perplexity/';

const SONAR_API_MODELS = new Set(['sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research']);

/** Returns true if the model should use the Sonar chat completions API instead of the Agent API. */
export const isSonarApiModel = (model: string): boolean => SONAR_API_MODELS.has(model);

/** Returns true if the model is a Perplexity-native Sonar model (not a third-party model routed via Perplexity). */
export const isPerplexityNativeModel = (model: string): boolean =>
	model === 'sonar' || SONAR_API_MODELS.has(model);

/** Send a request to Perplexity's Agent API (supports tool calling). */
export const sendPerplexityRequest = async (
	apiKey: string,
	model: string,
	input: string | PerplexityInputItem[],
	instructions?: string,
	tools?: PerplexityTool[],
): Promise<AIProviderResponse> => {
	const agentModel = model.includes('/') ? model : `${PERPLEXITY_MODEL_PREFIX}${model}`;
	const requestBody: Record<string, unknown> = { model: agentModel, input };
	if (instructions) {
		requestBody.instructions = instructions;
	}
	if (tools?.length) {
		requestBody.tools = tools;
	}

	const parsed = await makeRequest(apiKey, AGENT_API_PATH, JSON.stringify(requestBody));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const output = parsed.output as any[];
	if (!output?.length) {
		throw new Error('Empty response from Perplexity');
	}

	let textContent: string | null = null;
	const toolCalls: AIToolCall[] = [];

	for (const item of output) {
		if (item.type === 'message' && Array.isArray(item.content)) {
			for (const block of item.content) {
				if (block.type === 'output_text' && block.text) {
					textContent = (textContent ?? '') + block.text;
				}
			}
		} else if (item.type === 'function_call') {
			try {
				toolCalls.push({
					id: item.call_id,
					name: item.name,
					args: JSON.parse(item.arguments),
				});
			} catch {
				toolCalls.push({
					id: item.call_id,
					name: item.name,
					args: {},
				});
			}
		}
	}

	return {
		textContent,
		toolCalls,
		finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
		rawAssistantMessage: output,
	};
};

export interface SonarChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/** Send a request to Perplexity's Sonar chat completions API (no tool calling). */
export const sendSonarChatRequest = async (
	apiKey: string,
	model: string,
	messages: SonarChatMessage[],
): Promise<AIProviderResponse> => {
	const requestBody: Record<string, unknown> = { model, messages };
	const parsed = await makeRequest(apiKey, SONAR_API_PATH, JSON.stringify(requestBody));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const choices = parsed.choices as any[];
	if (!choices?.length) {
		throw new Error('Empty response from Perplexity Sonar');
	}
	const content = choices[0].message?.content ?? null;
	return {
		textContent: content || null,
		toolCalls: [],
		finishReason: choices[0].finish_reason ?? 'stop',
		rawAssistantMessage: choices[0].message,
	};
};

const TOOL_CALL_OPEN = '[TOOL_CALL]';
const TOOL_CALL_CLOSE = '[/TOOL_CALL]';
const TOOL_CALL_REGEX = /\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/g;

/** Parse `[TOOL_CALL]...[/TOOL_CALL]` markers from a Sonar model's plain-text response. */
export const parseSonarToolCalls = (
	text: string,
): { toolCalls: AIToolCall[]; cleanText: string } => {
	const toolCalls: AIToolCall[] = [];
	const regex = new RegExp(TOOL_CALL_REGEX.source, 'g');
	let match: RegExpExecArray | null;
	let callIndex = 0;
	while ((match = regex.exec(text)) !== null) {
		try {
			const parsed = JSON.parse(match[1]);
			if (parsed.name) {
				callIndex += 1;
				toolCalls.push({
					id: `sonar_tc_${Date.now()}_${callIndex}`,
					name: parsed.name,
					args: parsed.args ?? {},
				});
			}
		} catch {
			// Malformed JSON — skip this marker
		}
	}
	let cleanText = text.replace(TOOL_CALL_REGEX, '');
	const unclosedIdx = cleanText.indexOf(TOOL_CALL_OPEN);
	if (unclosedIdx !== -1) {
		cleanText = cleanText.substring(0, unclosedIdx);
	}
	cleanText = cleanText.replace(/\n{2,}/g, '\n').trim();
	return { toolCalls, cleanText };
};

/** Build a prompt section that teaches a Sonar model how to emit tool calls via markers. */
export const buildSonarToolCallPrompt = (tools: PerplexityTool[]): string => {
	if (tools.length === 0) return '';
	const toolDescriptions = tools.map((t) => {
		const params = t.parameters as {
			properties?: Record<string, { type?: string; description?: string }>;
			required?: string[];
		};
		const paramLines = Object.entries(params.properties ?? {}).map(([name, p]) => {
			const req = (params.required ?? []).includes(name) ? ' (required)' : '';
			return `    - ${name}: ${p.description ?? p.type ?? 'unknown'}${req}`;
		});
		return `  ${t.name}: ${t.description}\n${paramLines.join('\n')}`;
	});
	return `

${TOOL_CALL_OPEN} / ${TOOL_CALL_CLOSE} TOOL PROTOCOL:
When you need to perform an action (create, update, delete, search, etc.), output EXACTLY ONE tool call using this format — no extra text after the closing marker:
${TOOL_CALL_OPEN}{"name":"tool_name","args":{"param":"value"}}${TOOL_CALL_CLOSE}

Available tools:
${toolDescriptions.join('\n')}

After you output a tool call, STOP. The system will execute it and return the result in a [TOOL_RESULT] message. Then you can respond or call another tool.`;
};

export interface PerplexitySearchCitation {
	url: string;
	title: string;
}

export interface PerplexitySearchResult {
	content: string;
	citations: PerplexitySearchCitation[];
}

/**
 * Perform a one-shot web search using a Perplexity Sonar model.
 * Returns the answer text and structured citations extracted from the API response.
 */
export const performPerplexityWebSearch = async (
	apiKey: string,
	model: string,
	query: string,
): Promise<PerplexitySearchResult> => {
	if (!apiKey?.trim()) {
		throw new Error('Perplexity API key is required for web search');
	}
	if (!query?.trim()) {
		throw new Error('Search query cannot be empty');
	}
	const requestBody = {
		model,
		messages: [{ role: 'user', content: query }],
	};
	const parsed = await makeRequest(apiKey, SONAR_API_PATH, JSON.stringify(requestBody));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const choices = parsed.choices as any[];
	if (!choices?.length) {
		throw new Error('Empty response from Perplexity web search');
	}
	const content: string = choices[0].message?.content ?? '';
	const rawCitations = parsed.citations as string[] | undefined;
	const citations: PerplexitySearchCitation[] = (rawCitations ?? []).map((url) => ({
		url,
		title: url,
	}));
	return { content, citations };
};

/** Simple helper for one-shot Perplexity calls without tools. */
export const callPerplexity = async (
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
): Promise<string> => {
	const response = await sendPerplexityRequest(apiKey, model, userPrompt, systemPrompt);
	if (!response.textContent) {
		throw new Error('Empty response from Perplexity');
	}
	return response.textContent;
};
