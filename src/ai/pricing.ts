export interface ModelPricing {
	provider: 'openai' | 'claude' | 'perplexity';
	/** Cost per 1 million input tokens in USD */
	inputPer1M: number;
	/** Cost per 1 million output tokens in USD */
	outputPer1M: number;
	/** URL to the provider's pricing page */
	pricingUrl: string;
}

export interface TokenUsageCost {
	model: string;
	inputTokens: number;
	outputTokens: number;
	inputCost: number;
	outputCost: number;
	totalCost: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
	'gpt-5.4': {
		provider: 'openai',
		inputPer1M: 2.5,
		outputPer1M: 10,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'gpt-5.4-mini': {
		provider: 'openai',
		inputPer1M: 0.75,
		outputPer1M: 3,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'gpt-5.4-nano': {
		provider: 'openai',
		inputPer1M: 0.2,
		outputPer1M: 0.8,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'gpt-4.1': {
		provider: 'openai',
		inputPer1M: 2.0,
		outputPer1M: 8.0,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'gpt-4.1-mini': {
		provider: 'openai',
		inputPer1M: 0.4,
		outputPer1M: 1.6,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'gpt-4.1-nano': {
		provider: 'openai',
		inputPer1M: 0.1,
		outputPer1M: 0.4,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	o3: {
		provider: 'openai',
		inputPer1M: 2.0,
		outputPer1M: 8.0,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'o4-mini': {
		provider: 'openai',
		inputPer1M: 1.1,
		outputPer1M: 4.4,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'gpt-4o': {
		provider: 'openai',
		inputPer1M: 2.5,
		outputPer1M: 10.0,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'gpt-4o-mini': {
		provider: 'openai',
		inputPer1M: 0.15,
		outputPer1M: 0.6,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'gpt-4-turbo': {
		provider: 'openai',
		inputPer1M: 10.0,
		outputPer1M: 30.0,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'gpt-3.5-turbo': {
		provider: 'openai',
		inputPer1M: 0.5,
		outputPer1M: 1.5,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'codex-mini-latest': {
		provider: 'openai',
		inputPer1M: 1.5,
		outputPer1M: 6.0,
		pricingUrl: 'https://platform.openai.com/docs/pricing',
	},
	'claude-opus-4-20250514': {
		provider: 'claude',
		inputPer1M: 15.0,
		outputPer1M: 75.0,
		pricingUrl: 'https://docs.anthropic.com/en/about-claude/pricing',
	},
	'claude-sonnet-4-20250514': {
		provider: 'claude',
		inputPer1M: 3.0,
		outputPer1M: 15.0,
		pricingUrl: 'https://docs.anthropic.com/en/about-claude/pricing',
	},
	'claude-3-5-sonnet-20241022': {
		provider: 'claude',
		inputPer1M: 3.0,
		outputPer1M: 15.0,
		pricingUrl: 'https://docs.anthropic.com/en/about-claude/pricing',
	},
	'claude-3-haiku-20240307': {
		provider: 'claude',
		inputPer1M: 0.25,
		outputPer1M: 1.25,
		pricingUrl: 'https://docs.anthropic.com/en/about-claude/pricing',
	},
	sonar: {
		provider: 'perplexity',
		inputPer1M: 1.0,
		outputPer1M: 1.0,
		pricingUrl: 'https://docs.perplexity.ai/pricing',
	},
	'sonar-pro': {
		provider: 'perplexity',
		inputPer1M: 3.0,
		outputPer1M: 15.0,
		pricingUrl: 'https://docs.perplexity.ai/pricing',
	},
	'sonar-reasoning-pro': {
		provider: 'perplexity',
		inputPer1M: 2.0,
		outputPer1M: 8.0,
		pricingUrl: 'https://docs.perplexity.ai/pricing',
	},
	'sonar-deep-research': {
		provider: 'perplexity',
		inputPer1M: 2.0,
		outputPer1M: 8.0,
		pricingUrl: 'https://docs.perplexity.ai/pricing',
	},
};

export const getModelPricing = (model: string): ModelPricing | null =>
	MODEL_PRICING[model] ?? null;

export const calculateRequestCost = (
	model: string,
	inputTokens: number,
	outputTokens: number,
): TokenUsageCost | null => {
	const pricing = getModelPricing(model);
	if (!pricing) return null;
	const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
	const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
	return {
		model,
		inputTokens,
		outputTokens,
		inputCost,
		outputCost,
		totalCost: inputCost + outputCost,
	};
};
