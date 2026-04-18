export interface ActionResult {
	success: boolean;
	message: string;
	data?: Record<string, unknown>;
}

export interface Notebook {
	id: string;
	title: string;
}

export interface ReferencedNote {
	id: string;
	title: string;
	body: string;
}

export interface AttachedFile {
	name: string;
	content: string;
	mimeType: string;
	size: number;
	/** Raw file bytes encoded as base64. Present when the lightweight text extractor could not parse the PDF, so the raw document is sent to the LLM instead. */
	base64Data?: string;
}

export interface ImageProgressInfo {
	progress: number;
	state: string;
}

export interface ThinkingStepInfo {
	step: string;
	label: string;
}

export interface ActionContext {
	currentNoteId: string | null;
	currentNoteTitle: string | null;
	notebooks?: Notebook[];
	referencedNotes?: ReferencedNote[];
	attachedFiles?: AttachedFile[];
	agentRolePrompt?: string;
	workMode?: 'ask' | 'agent' | 'edit';
	webSearchEnabled?: boolean;
	/** Combined "provider:model" string for web search, e.g. "openai:gpt-4o-search-preview" or "perplexity:sonar-pro". */
	webSearchModel?: string;
	openaiApiKey?: string;
	perplexityApiKey?: string;
	kieApiKey?: string;
	imageGenModel?: string;
	onImageProgress?: (info: ImageProgressInfo) => void;
	onThinkingStep?: (info: ThinkingStepInfo) => void;
	onStreamChunk?: (text: string) => void;
}

export interface ActionHandler {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (args: Record<string, unknown>, context: ActionContext) => Promise<ActionResult>;
}
