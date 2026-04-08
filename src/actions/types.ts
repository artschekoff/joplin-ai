export interface ActionResult {
	success: boolean;
	message: string;
	data?: Record<string, unknown>;
}

export interface ActionContext {
	currentNoteId: string | null;
	currentNoteTitle: string | null;
}

export interface ActionHandler {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (args: Record<string, unknown>, context: ActionContext) => Promise<ActionResult>;
}
