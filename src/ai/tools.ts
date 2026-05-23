import { getActionHandlers, READ_ONLY_ACTIONS, EDIT_ACTIONS } from '../actions/registry';
import { WorkMode } from './types';
import { ActionHandler } from '../actions/types';

export interface OpenAITool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

export interface ClaudeTool {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
}

export interface PerplexityTool {
	type: 'function';
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

const filterHandlers = (
	handlers: ActionHandler[],
	workMode?: WorkMode,
	kieApiKey?: string,
): ActionHandler[] => {
	let filtered = handlers;
	if (workMode && workMode !== 'agent') {
		const allowed = workMode === 'ask' ? READ_ONLY_ACTIONS : EDIT_ACTIONS;
		filtered = filtered.filter((h) => allowed.has(h.name));
	}
	if (!kieApiKey?.trim()) {
		filtered = filtered.filter((h) => h.name !== 'generate_image');
	}
	return filtered;
};

export const getOpenAITools = (workMode?: WorkMode, kieApiKey?: string): OpenAITool[] =>
	filterHandlers(getActionHandlers(), workMode, kieApiKey).map((h) => ({
		type: 'function' as const,
		function: {
			name: h.name,
			description: h.description,
			parameters: h.parameters,
		},
	}));

export const getClaudeTools = (workMode?: WorkMode, kieApiKey?: string): ClaudeTool[] =>
	filterHandlers(getActionHandlers(), workMode, kieApiKey).map((h) => ({
		name: h.name,
		description: h.description,
		input_schema: h.parameters,
	}));

export const getPerplexityTools = (
	workMode?: WorkMode,
	nativeWebSearch = true,
	kieApiKey?: string,
): PerplexityTool[] =>
	filterHandlers(getActionHandlers(), workMode, kieApiKey)
		.filter((h) => (nativeWebSearch ? h.name !== 'web_search' : true))
		.map((h) => ({
			type: 'function' as const,
			name: h.name,
			description: h.description,
			parameters: h.parameters,
		}));
