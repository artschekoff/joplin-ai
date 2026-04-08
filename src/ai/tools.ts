import { getActionHandlers } from '../actions/registry';

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

export const getOpenAITools = (): OpenAITool[] =>
	getActionHandlers().map((h) => ({
		type: 'function' as const,
		function: {
			name: h.name,
			description: h.description,
			parameters: h.parameters,
		},
	}));

export const getClaudeTools = (): ClaudeTool[] =>
	getActionHandlers().map((h) => ({
		name: h.name,
		description: h.description,
		input_schema: h.parameters,
	}));
