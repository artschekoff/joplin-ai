export type AIProvider = 'openai' | 'claude';

export interface AIMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface AIRequest {
	provider: AIProvider;
	apiKey: string;
	model: string;
	systemPrompt: string;
	userPrompt: string;
}

export interface AIResponse {
	content: string;
	isEdit: boolean;
	editedBody?: string;
}
