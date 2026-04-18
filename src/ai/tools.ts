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

const filterHandlers = (handlers: ActionHandler[], workMode?: WorkMode): ActionHandler[] => {
	if (!workMode || workMode === 'agent') return handlers;
	const allowed = workMode === 'ask' ? READ_ONLY_ACTIONS : EDIT_ACTIONS;
	return handlers.filter((h) => allowed.has(h.name));
};

export const getOpenAITools = (workMode?: WorkMode): OpenAITool[] =>
	filterHandlers(getActionHandlers(), workMode).map((h) => ({
		type: 'function' as const,
		function: {
			name: h.name,
			description: h.description,
			parameters: h.parameters,
		},
	}));

export const getClaudeTools = (workMode?: WorkMode): ClaudeTool[] =>
	filterHandlers(getActionHandlers(), workMode).map((h) => ({
		name: h.name,
		description: h.description,
		input_schema: h.parameters,
	}));

export const getPerplexityTools = (
	workMode?: WorkMode,
	nativeWebSearch = true,
): PerplexityTool[] =>
	filterHandlers(getActionHandlers(), workMode)
		.filter((h) => nativeWebSearch ? h.name !== 'web_search' : true)
		.map((h) => ({
			type: 'function' as const,
			name: h.name,
			description: h.description,
			parameters: h.parameters,
		}));
