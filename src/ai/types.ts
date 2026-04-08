export type AIProvider = 'openai' | 'claude';

export interface AIToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}

export interface AIProviderResponse {
	textContent: string | null;
	toolCalls: AIToolCall[];
	finishReason: string;
	rawAssistantMessage: unknown;
}

export interface AIActionOutcome {
	action: string;
	success: boolean;
	message: string;
	data?: Record<string, unknown>;
}

export interface AIResponse {
	content: string;
	isEdit: boolean;
	editedBody?: string;
	actions: AIActionOutcome[];
}
