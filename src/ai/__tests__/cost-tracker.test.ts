import { describe, it, expect, beforeEach } from '@jest/globals';
import {
	LocalCostTracker,
	CostTracker,
	Generation,
	UsageDetails,
	CostDetails,
} from '../cost-tracker';

describe('LocalCostTracker', () => {
	let tracker: LocalCostTracker;

	beforeEach(() => {
		tracker = new LocalCostTracker();
	});

	describe('startGeneration', () => {
		it('returns a generation with correct fields', () => {
			const gen = tracker.startGeneration('t1', { model: 'gpt-4o', name: 'test' });

			expect(gen.id).toBeTruthy();
			expect(gen.traceId).toBe('t1');
			expect(gen.model).toBe('gpt-4o');
			expect(gen.name).toBe('test');
			expect(gen.startTime).toBeInstanceOf(Date);
			expect(gen.endTime).toBeUndefined();
			expect(gen.usageDetails).toEqual({ input: 0, output: 0, total: 0 });
			expect(gen.costDetails).toEqual({ input: 0, output: 0, total: 0 });
		});

		it('assigns unique IDs to each generation', () => {
			const g1 = tracker.startGeneration('t1', { model: 'gpt-4o' });
			const g2 = tracker.startGeneration('t1', { model: 'gpt-4o' });
			expect(g1.id).not.toBe(g2.id);
		});

		it('stores input and metadata when provided', () => {
			const gen = tracker.startGeneration('t1', {
				model: 'gpt-4o',
				input: { messages: [{ role: 'user', content: 'hi' }] },
				metadata: { userId: 'u1' },
			});
			expect(gen.input).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
			expect(gen.metadata).toEqual({ userId: 'u1' });
		});
	});

	describe('endGeneration', () => {
		it('sets endTime and usage on the generation', () => {
			const gen = tracker.startGeneration('t1', { model: 'gpt-4o' });
			const ended = tracker.endGeneration(gen, {
				usageDetails: { input: 100, output: 50 },
			});

			expect(ended.endTime).toBeInstanceOf(Date);
			expect(ended.usageDetails.input).toBe(100);
			expect(ended.usageDetails.output).toBe(50);
			expect(ended.usageDetails.total).toBe(150);
		});

		it('infers cost from MODEL_PRICING when costDetails not provided', () => {
			const gen = tracker.startGeneration('t1', { model: 'gpt-4o' });
			const ended = tracker.endGeneration(gen, {
				usageDetails: { input: 1_000_000, output: 1_000_000 },
			});

			expect(ended.costDetails.input).toBeCloseTo(2.5, 2);
			expect(ended.costDetails.output).toBeCloseTo(10, 2);
			expect(ended.costDetails.total).toBeCloseTo(12.5, 2);
		});

		it('uses explicit costDetails when provided', () => {
			const gen = tracker.startGeneration('t1', { model: 'gpt-4o' });
			const ended = tracker.endGeneration(gen, {
				usageDetails: { input: 100, output: 50 },
				costDetails: { input: 0.001, output: 0.002 },
			});

			expect(ended.costDetails.input).toBe(0.001);
			expect(ended.costDetails.output).toBe(0.002);
			expect(ended.costDetails.total).toBeCloseTo(0.003, 6);
		});

		it('respects explicit total in costDetails', () => {
			const gen = tracker.startGeneration('t1', { model: 'gpt-4o' });
			const ended = tracker.endGeneration(gen, {
				usageDetails: { input: 100, output: 50 },
				costDetails: { input: 0.001, output: 0.002, total: 0.005 },
			});

			expect(ended.costDetails.total).toBe(0.005);
		});

		it('respects explicit total in usageDetails', () => {
			const gen = tracker.startGeneration('t1', { model: 'gpt-4o' });
			const ended = tracker.endGeneration(gen, {
				usageDetails: { input: 100, output: 50, total: 200 },
			});

			expect(ended.usageDetails.total).toBe(200);
		});

		it('leaves cost at zero for unknown models without explicit costDetails', () => {
			const gen = tracker.startGeneration('t1', { model: 'unknown-model' });
			const ended = tracker.endGeneration(gen, {
				usageDetails: { input: 500, output: 200 },
			});

			expect(ended.costDetails.input).toBe(0);
			expect(ended.costDetails.output).toBe(0);
			expect(ended.costDetails.total).toBe(0);
		});

		it('stores output on the generation', () => {
			const gen = tracker.startGeneration('t1', { model: 'gpt-4o' });
			const ended = tracker.endGeneration(gen, {
				output: 'Hello world',
				usageDetails: { input: 10, output: 5 },
			});

			expect(ended.output).toBe('Hello world');
		});
	});

	describe('getTraceUsage', () => {
		it('aggregates usage across multiple generations in a trace', () => {
			const g1 = tracker.startGeneration('t1', { model: 'gpt-4o' });
			tracker.endGeneration(g1, { usageDetails: { input: 100, output: 50 } });
			const g2 = tracker.startGeneration('t1', { model: 'gpt-4o' });
			tracker.endGeneration(g2, { usageDetails: { input: 200, output: 100 } });

			const usage = tracker.getTraceUsage('t1');
			expect(usage.input).toBe(300);
			expect(usage.output).toBe(150);
			expect(usage.total).toBe(450);
		});

		it('returns zeros for unknown trace', () => {
			const usage = tracker.getTraceUsage('nonexistent');
			expect(usage.input).toBe(0);
			expect(usage.output).toBe(0);
			expect(usage.total).toBe(0);
		});

		it('keeps traces isolated from each other', () => {
			const g1 = tracker.startGeneration('t1', { model: 'gpt-4o' });
			tracker.endGeneration(g1, { usageDetails: { input: 100, output: 50 } });
			const g2 = tracker.startGeneration('t2', { model: 'gpt-4o' });
			tracker.endGeneration(g2, { usageDetails: { input: 999, output: 999 } });

			const usage = tracker.getTraceUsage('t1');
			expect(usage.input).toBe(100);
			expect(usage.output).toBe(50);
		});
	});

	describe('getTraceCost', () => {
		it('aggregates cost across multiple generations', () => {
			const g1 = tracker.startGeneration('t1', { model: 'gpt-4o' });
			tracker.endGeneration(g1, {
				usageDetails: { input: 1_000_000, output: 0 },
			});
			const g2 = tracker.startGeneration('t1', { model: 'gpt-4o' });
			tracker.endGeneration(g2, {
				usageDetails: { input: 0, output: 1_000_000 },
			});

			const cost = tracker.getTraceCost('t1');
			expect(cost.input).toBeCloseTo(2.5, 2);
			expect(cost.output).toBeCloseTo(10, 2);
			expect(cost.total).toBeCloseTo(12.5, 2);
		});

		it('returns zeros for unknown trace', () => {
			const cost = tracker.getTraceCost('nonexistent');
			expect(cost.input).toBe(0);
			expect(cost.output).toBe(0);
			expect(cost.total).toBe(0);
		});

		it('aggregates mixed inferred and explicit costs', () => {
			const g1 = tracker.startGeneration('t1', { model: 'gpt-4o' });
			tracker.endGeneration(g1, {
				usageDetails: { input: 1_000_000, output: 1_000_000 },
			});
			const g2 = tracker.startGeneration('t1', { model: 'custom-model' });
			tracker.endGeneration(g2, {
				usageDetails: { input: 500, output: 500 },
				costDetails: { input: 1.0, output: 2.0, total: 3.0 },
			});

			const cost = tracker.getTraceCost('t1');
			expect(cost.input).toBeCloseTo(3.5, 2);
			expect(cost.output).toBeCloseTo(12.0, 2);
			expect(cost.total).toBeCloseTo(15.5, 2);
		});
	});

	describe('interface compatibility', () => {
		it('satisfies the CostTracker interface', () => {
			const ct: CostTracker = new LocalCostTracker();
			expect(ct.startGeneration).toBeDefined();
			expect(ct.endGeneration).toBeDefined();
			expect(ct.getTraceUsage).toBeDefined();
			expect(ct.getTraceCost).toBeDefined();
		});

		it('supports Langfuse-style usageDetails with extra keys', () => {
			const gen = tracker.startGeneration('t1', { model: 'gpt-4o' });
			const usage: UsageDetails = {
				input: 100,
				output: 50,
				cached_tokens: 20,
			};
			const ended = tracker.endGeneration(gen, { usageDetails: usage });

			expect(ended.usageDetails.cached_tokens).toBe(20);
			expect(ended.usageDetails.input).toBe(100);
		});

		it('supports Langfuse-style costDetails with extra keys', () => {
			const gen = tracker.startGeneration('t1', { model: 'gpt-4o' });
			const cost: CostDetails = {
				input: 0.01,
				output: 0.02,
				cached_tokens: 0.005,
			};
			const ended = tracker.endGeneration(gen, {
				usageDetails: { input: 100, output: 50 },
				costDetails: cost,
			});

			expect(ended.costDetails.cached_tokens).toBe(0.005);
		});
	});
});
