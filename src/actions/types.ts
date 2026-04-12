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
}

export interface ImageProgressInfo {
	progress: number;
	state: string;
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
	openaiApiKey?: string;
	kieApiKey?: string;
	imageGenModel?: string;
	onImageProgress?: (info: ImageProgressInfo) => void;
}

export interface ActionHandler {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (args: Record<string, unknown>, context: ActionContext) => Promise<ActionResult>;
}
