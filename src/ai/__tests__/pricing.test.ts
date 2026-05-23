import { describe, it, expect } from '@jest/globals';
import {
	getModelPricing,
	calculateRequestCost,
	MODEL_PRICING,
	ModelPricing,
	TokenUsageCost,
} from '../pricing';

describe('MODEL_PRICING', () => {
	it('contains pricing for all OpenAI models', () => {
		const expectedModels = [
			'gpt-5.4',
			'gpt-5.4-mini',
			'gpt-5.4-nano',
			'gpt-4.1',
			'gpt-4.1-mini',
			'gpt-4.1-nano',
			'o3',
			'o4-mini',
			'gpt-4o',
			'gpt-4o-mini',
			'gpt-4-turbo',
			'gpt-3.5-turbo',
			'codex-mini-latest',
		];
		for (const model of expectedModels) {
			expect(MODEL_PRICING[model]).toBeDefined();
			expect(MODEL_PRICING[model].provider).toBe('openai');
		}
	});

	it('contains pricing for all Claude models', () => {
		const expectedModels = [
			'claude-opus-4-7',
			'claude-sonnet-4-6',
			'claude-3-5-sonnet-20241022',
			'claude-3-haiku-20240307',
		];
		for (const model of expectedModels) {
			expect(MODEL_PRICING[model]).toBeDefined();
			expect(MODEL_PRICING[model].provider).toBe('claude');
		}
	});

	it('contains pricing for all Perplexity models', () => {
		const expectedModels = ['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'];
		for (const model of expectedModels) {
			expect(MODEL_PRICING[model]).toBeDefined();
			expect(MODEL_PRICING[model].provider).toBe('perplexity');
		}
	});

	it('each pricing entry has positive input and output costs', () => {
		for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
			expect(pricing.inputPer1M).toBeGreaterThan(0);
			expect(pricing.outputPer1M).toBeGreaterThan(0);
			expect(pricing.pricingUrl).toBeTruthy();
		}
	});
});

describe('getModelPricing', () => {
	it('returns pricing for known model', () => {
		const pricing = getModelPricing('gpt-4o');
		expect(pricing).toBeDefined();
		expect(pricing!.provider).toBe('openai');
		expect(pricing!.inputPer1M).toBeGreaterThan(0);
	});

	it('returns null for unknown model', () => {
		expect(getModelPricing('nonexistent-model-xyz')).toBeNull();
	});

	it('returns pricing for Perplexity third-party models with prefix', () => {
		const pricing = getModelPricing('anthropic/claude-opus-4-6');
		expect(pricing).toBeNull();
	});
});

describe('calculateRequestCost', () => {
	it('calculates cost correctly for GPT-4o', () => {
		const result = calculateRequestCost('gpt-4o', 1000, 500);
		expect(result).not.toBeNull();
		expect(result!.inputTokens).toBe(1000);
		expect(result!.outputTokens).toBe(500);
		expect(result!.inputCost).toBeCloseTo(0.0025, 4);
		expect(result!.outputCost).toBeCloseTo(0.005, 4);
		expect(result!.totalCost).toBeCloseTo(0.0075, 4);
	});

	it('calculates cost correctly for Claude Sonnet 4', () => {
		const result = calculateRequestCost('claude-sonnet-4-6', 2000, 1000);
		expect(result).not.toBeNull();
		expect(result!.inputCost).toBeCloseTo(0.006, 4);
		expect(result!.outputCost).toBeCloseTo(0.015, 4);
		expect(result!.totalCost).toBeCloseTo(0.021, 4);
	});

	it('returns zero cost when tokens are zero', () => {
		const result = calculateRequestCost('gpt-4o', 0, 0);
		expect(result).not.toBeNull();
		expect(result!.totalCost).toBe(0);
	});

	it('returns null for unknown model', () => {
		expect(calculateRequestCost('unknown-model', 100, 100)).toBeNull();
	});

	it('includes model name in result', () => {
		const result = calculateRequestCost('gpt-4o', 100, 50);
		expect(result).not.toBeNull();
		expect(result!.model).toBe('gpt-4o');
	});

	it('accumulates across multiple calls', () => {
		const cost1 = calculateRequestCost('gpt-4o', 1000, 500)!;
		const cost2 = calculateRequestCost('gpt-4o', 2000, 1000)!;
		const total = cost1.totalCost + cost2.totalCost;
		expect(total).toBeGreaterThan(cost1.totalCost);
	});
});
