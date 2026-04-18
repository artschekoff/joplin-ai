import { getModelPricing, ModelPricing } from './pricing';

/** Langfuse-compatible usage details: token counts keyed by type. */
export interface UsageDetails {
	input: number;
	output: number;
	total?: number;
	[key: string]: number | undefined;
}

/** Langfuse-compatible cost details: USD amounts keyed by type. */
export interface CostDetails {
	input: number;
	output: number;
	total?: number;
	[key: string]: number | undefined;
}

export interface StartGenerationParams {
	name?: string;
	model: string;
	input?: unknown;
	metadata?: Record<string, unknown>;
}

export interface EndGenerationParams {
	output?: unknown;
	usageDetails: UsageDetails;
	costDetails?: CostDetails;
}

/** Langfuse-compatible generation observation. */
export interface Generation {
	id: string;
	traceId: string;
	name?: string;
	model: string;
	startTime: Date;
	endTime?: Date;
	completionStartTime?: Date;
	usageDetails: UsageDetails;
	costDetails: CostDetails;
	input?: unknown;
	output?: unknown;
	metadata?: Record<string, unknown>;
}

/**
 * Langfuse-compatible cost tracking interface.
 *
 * Swap in a real Langfuse client (or any other observability backend)
 * by implementing this interface. The default `LocalCostTracker` computes
 * costs from a built-in pricing table with zero network calls.
 */
export interface CostTracker {
	startGeneration(traceId: string, params: StartGenerationParams): Generation;
	endGeneration(generation: Generation, params: EndGenerationParams): Generation;
	getTraceUsage(traceId: string): UsageDetails;
	getTraceCost(traceId: string): CostDetails;
}

let nextId = 0;
const generateId = (): string => `gen-${Date.now()}-${++nextId}`;

const inferCost = (
	usage: UsageDetails,
	pricing: ModelPricing,
): CostDetails => {
	const inputCost = (usage.input / 1_000_000) * pricing.inputPer1M;
	const outputCost = (usage.output / 1_000_000) * pricing.outputPer1M;
	return { input: inputCost, output: outputCost, total: inputCost + outputCost };
};

const sumDetails = <T extends UsageDetails | CostDetails>(items: T[]): T => {
	const result = { input: 0, output: 0, total: 0 } as T;
	for (const item of items) {
		result.input += item.input;
		result.output += item.output;
		result.total = ((result.total as number) ?? 0) + ((item.total as number) ?? 0);
	}
	return result;
};

/**
 * Default in-process cost tracker that infers costs from the built-in
 * {@link MODEL_PRICING} table. Drop-in replacement for a remote Langfuse
 * client — pass any {@link CostTracker} implementation to `sendToAI` to
 * route observations elsewhere.
 */
export class LocalCostTracker implements CostTracker {
	private traces = new Map<string, Generation[]>();

	startGeneration(traceId: string, params: StartGenerationParams): Generation {
		const gen: Generation = {
			id: generateId(),
			traceId,
			name: params.name,
			model: params.model,
			startTime: new Date(),
			input: params.input,
			metadata: params.metadata,
			usageDetails: { input: 0, output: 0, total: 0 },
			costDetails: { input: 0, output: 0, total: 0 },
		};
		let list = this.traces.get(traceId);
		if (!list) {
			list = [];
			this.traces.set(traceId, list);
		}
		list.push(gen);
		return gen;
	}

	endGeneration(generation: Generation, params: EndGenerationParams): Generation {
		generation.endTime = new Date();
		generation.output = params.output;
		generation.usageDetails = {
			...params.usageDetails,
			total:
				params.usageDetails.total ??
				params.usageDetails.input + params.usageDetails.output,
		};

		if (params.costDetails) {
			generation.costDetails = {
				...params.costDetails,
				total:
					params.costDetails.total ??
					(params.costDetails.input ?? 0) + (params.costDetails.output ?? 0),
			};
		} else {
			const pricing = getModelPricing(generation.model);
			if (pricing) {
				generation.costDetails = inferCost(generation.usageDetails, pricing);
			}
		}

		return generation;
	}

	getTraceUsage(traceId: string): UsageDetails {
		const gens = this.traces.get(traceId) ?? [];
		return sumDetails(gens.map((g) => g.usageDetails));
	}

	getTraceCost(traceId: string): CostDetails {
		const gens = this.traces.get(traceId) ?? [];
		return sumDetails(gens.map((g) => g.costDetails));
	}
}

/** Singleton tracker used by default throughout the plugin. */
export const defaultCostTracker: CostTracker = new LocalCostTracker();
