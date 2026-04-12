import { estimateTokens, getModelMaxTokens, computeContextUsage } from '../context-size';

describe('estimateTokens', () => {
	it('should return 0 for empty string', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('should estimate tokens for short text', () => {
		const result = estimateTokens('Hello world');
		expect(result).toBeGreaterThan(0);
		expect(typeof result).toBe('number');
	});

	it('should estimate roughly 1 token per 4 characters', () => {
		const text = 'a'.repeat(400);
		const tokens = estimateTokens(text);
		expect(tokens).toBe(100);
	});

	it('should round up partial tokens', () => {
		const text = 'a'.repeat(5);
		const tokens = estimateTokens(text);
		expect(tokens).toBe(2);
	});

	it('should handle undefined/null gracefully', () => {
		expect(estimateTokens(undefined as unknown as string)).toBe(0);
		expect(estimateTokens(null as unknown as string)).toBe(0);
	});
});

describe('getModelMaxTokens', () => {
	it('should return 128000 for gpt-4o', () => {
		expect(getModelMaxTokens('gpt-4o')).toBe(128000);
	});

	it('should return 128000 for gpt-4o-mini', () => {
		expect(getModelMaxTokens('gpt-4o-mini')).toBe(128000);
	});

	it('should return 128000 for gpt-4-turbo', () => {
		expect(getModelMaxTokens('gpt-4-turbo')).toBe(128000);
	});

	it('should return 16385 for gpt-3.5-turbo', () => {
		expect(getModelMaxTokens('gpt-3.5-turbo')).toBe(16385);
	});

	it('should return 200000 for claude-sonnet-4-20250514', () => {
		expect(getModelMaxTokens('claude-sonnet-4-20250514')).toBe(200000);
	});

	it('should return 200000 for claude-3-5-sonnet-20241022', () => {
		expect(getModelMaxTokens('claude-3-5-sonnet-20241022')).toBe(200000);
	});

	it('should return 200000 for claude-3-haiku-20240307', () => {
		expect(getModelMaxTokens('claude-3-haiku-20240307')).toBe(200000);
	});

	it('should return 200000 for claude-opus-4-20250514', () => {
		expect(getModelMaxTokens('claude-opus-4-20250514')).toBe(200000);
	});

	it('should return 200000 for codex-mini-latest', () => {
		expect(getModelMaxTokens('codex-mini-latest')).toBe(200000);
	});

	it('should return a sensible default for unknown models', () => {
		const result = getModelMaxTokens('unknown-model');
		expect(result).toBeGreaterThan(0);
		expect(result).toBe(128000);
	});
});

describe('computeContextUsage', () => {
	it('should return usedTokens and maxTokens', () => {
		const result = computeContextUsage({
			systemPrompt: 'You are an assistant.',
			history: [],
			userPrompt: 'Hello',
			model: 'gpt-4o',
		});
		expect(result).toHaveProperty('usedTokens');
		expect(result).toHaveProperty('maxTokens');
		expect(result).toHaveProperty('percentage');
		expect(result.usedTokens).toBeGreaterThan(0);
		expect(result.maxTokens).toBe(128000);
	});

	it('should return 0% when inputs are empty', () => {
		const result = computeContextUsage({
			systemPrompt: '',
			history: [],
			userPrompt: '',
			model: 'gpt-4o',
		});
		expect(result.usedTokens).toBe(0);
		expect(result.percentage).toBe(0);
	});

	it('should include history in token count', () => {
		const withoutHistory = computeContextUsage({
			systemPrompt: 'system',
			history: [],
			userPrompt: 'hello',
			model: 'gpt-4o',
		});

		const withHistory = computeContextUsage({
			systemPrompt: 'system',
			history: [
				{ role: 'user', content: 'Previous question that was quite long' },
				{ role: 'assistant', content: 'Previous answer that was also fairly long' },
			],
			userPrompt: 'hello',
			model: 'gpt-4o',
		});

		expect(withHistory.usedTokens).toBeGreaterThan(withoutHistory.usedTokens);
	});

	it('should compute percentage as ratio of used to max', () => {
		const result = computeContextUsage({
			systemPrompt: 'a'.repeat(4000),
			history: [],
			userPrompt: '',
			model: 'gpt-4o',
		});
		const expectedPercentage = (result.usedTokens / result.maxTokens) * 100;
		expect(result.percentage).toBeCloseTo(expectedPercentage, 1);
	});

	it('should cap percentage at 100', () => {
		const result = computeContextUsage({
			systemPrompt: 'a'.repeat(600000),
			history: [],
			userPrompt: '',
			model: 'gpt-3.5-turbo',
		});
		expect(result.percentage).toBeLessThanOrEqual(100);
	});

	it('should use correct model max tokens', () => {
		const gptResult = computeContextUsage({
			systemPrompt: 'test',
			history: [],
			userPrompt: 'test',
			model: 'gpt-3.5-turbo',
		});
		const claudeResult = computeContextUsage({
			systemPrompt: 'test',
			history: [],
			userPrompt: 'test',
			model: 'claude-sonnet-4-20250514',
		});
		expect(gptResult.maxTokens).toBe(16385);
		expect(claudeResult.maxTokens).toBe(200000);
	});
});
