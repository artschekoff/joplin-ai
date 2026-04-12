export type AIProvider = 'openai' | 'claude' | 'perplexity';

export type WorkMode = 'ask' | 'agent' | 'edit';

export interface AgentRole {
	id: string;
	name: string;
	systemPrompt: string;
}

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

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
