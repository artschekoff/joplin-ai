import { ChatMessage } from './types';

const MODEL_MAX_TOKENS: Record<string, number> = {
	'gpt-5.4': 1050000,
	'gpt-5.4-mini': 400000,
	'gpt-5.4-nano': 400000,
	'gpt-4.1': 1047576,
	'gpt-4.1-mini': 1047576,
	'gpt-4.1-nano': 1047576,
	o3: 200000,
	'o4-mini': 200000,
	'gpt-4o': 128000,
	'gpt-4o-mini': 128000,
	'gpt-4o-search-preview': 128000,
	'gpt-4-turbo': 128000,
	'gpt-3.5-turbo': 16385,
	'claude-opus-4-7': 200000,
	'claude-sonnet-4-6': 200000,
	'claude-3-5-sonnet-20241022': 200000,
	'claude-3-haiku-20240307': 200000,
	'codex-mini-latest': 200000,
	sonar: 128000,
	'sonar-pro': 200000,
	'sonar-reasoning-pro': 128000,
	'sonar-deep-research': 128000,
};

const DEFAULT_MAX_TOKENS = 128000;
const CHARS_PER_TOKEN = 4;

export interface ContextUsage {
	usedTokens: number;
	maxTokens: number;
	percentage: number;
}

/** Rough token estimate: ~4 characters per token, rounded up. */
export const estimateTokens = (text: string): number => {
	if (!text) return 0;
	return Math.ceil(text.length / CHARS_PER_TOKEN);
};

export const getModelMaxTokens = (model: string): number =>
	MODEL_MAX_TOKENS[model] ?? DEFAULT_MAX_TOKENS;

export const computeContextUsage = (params: {
	/** Full concatenated system prompt string, OR the three parts of SystemPromptParts. */
	systemPrompt?: string;
	staticInstructions?: string;
	noteBodyContext?: string;
	dynamicContext?: string;
	history: ChatMessage[];
	userPrompt: string;
	model: string;
}): ContextUsage => {
	const {
		systemPrompt,
		staticInstructions,
		noteBodyContext,
		dynamicContext,
		history,
		userPrompt,
		model,
	} = params;

	const resolvedSystemText =
		systemPrompt ?? (staticInstructions ?? '') + (noteBodyContext ?? '') + (dynamicContext ?? '');

	const historyText = history.map((m) => m.content).join('');
	const totalText = resolvedSystemText + historyText + (userPrompt || '');
	const usedTokens = estimateTokens(totalText);
	const maxTokens = getModelMaxTokens(model);
	const percentage = maxTokens > 0 ? Math.min((usedTokens / maxTokens) * 100, 100) : 0;

	return { usedTokens, maxTokens, percentage };
};
