import joplin from 'api';
import { ActionResult, ActionContext, ActionHandler } from './types';

const createNoteHandler: ActionHandler = {
	name: 'create_note',
	description: 'Create a new note in Joplin. Returns the ID of the created note.',
	parameters: {
		type: 'object',
		properties: {
			title: { type: 'string', description: 'Title of the new note' },
			body: { type: 'string', description: 'Markdown body of the new note' },
			parentId: {
				type: 'string',
				description:
					'ID of the notebook to create the note in. Use list_notebooks to find IDs.',
			},
		},
		required: ['title', 'body'],
	},
	execute: async (args) => {
		const note = await joplin.data.post(['notes'], null, {
			title: args.title as string,
			body: args.body as string,
			parent_id: args.parentId as string | undefined,
		});
		return {
			success: true,
			message: `Note "${note.title}" created`,
			data: { id: note.id, title: note.title },
		};
	},
};

const getNoteHandler: ActionHandler = {
	name: 'get_note',
	description:
		'Read a note by ID. Returns the title, body, and parent notebook ID. Use after search_notes to read a specific result.',
	parameters: {
		type: 'object',
		properties: {
			noteId: { type: 'string', description: 'ID of the note to read' },
		},
		required: ['noteId'],
	},
	execute: async (args) => {
		const note = await joplin.data.get(['notes', args.noteId as string], {
			fields: ['id', 'title', 'body', 'parent_id'],
		});
		if (!note) {
			return { success: false, message: 'Note not found' };
		}
		return {
			success: true,
			message: `Read note "${note.title}"`,
			data: { id: note.id, title: note.title, body: note.body, parentId: note.parent_id },
		};
	},
};

const updateNoteHandler: ActionHandler = {
	name: 'update_note',
	description:
		'Update the currently selected note. Can change the title, body, or both. Provide only the fields you want to change.',
	parameters: {
		type: 'object',
		properties: {
			title: { type: 'string', description: 'New title for the note (optional)' },
			body: {
				type: 'string',
				description: 'Complete new Markdown body for the note (optional)',
			},
		},
	},
	execute: async (args, context) => {
		if (!context.currentNoteId) {
			return { success: false, message: 'No note is currently selected' };
		}
		const updates: Record<string, unknown> = {};
		if (args.title !== undefined) updates.title = args.title;
		if (args.body !== undefined) updates.body = args.body;
		if (Object.keys(updates).length === 0) {
			return { success: false, message: 'No fields provided to update' };
		}
		await joplin.data.put(['notes', context.currentNoteId], null, updates);
		const parts = Object.keys(updates).join(' and ');
		return { success: true, message: `Note "${context.currentNoteTitle}" ${parts} updated` };
	},
};

const deleteNoteHandler: ActionHandler = {
	name: 'delete_note',
	description:
		'Delete a note by ID. This is irreversible. Ask the user for confirmation before deleting.',
	parameters: {
		type: 'object',
		properties: {
			noteId: {
				type: 'string',
				description:
					'ID of the note to delete. If omitted, deletes the currently selected note.',
			},
		},
	},
	execute: async (args, context) => {
		const noteId = (args.noteId as string) || context.currentNoteId;
		if (!noteId) {
			return { success: false, message: 'No note ID provided and no note is selected' };
		}
		const note = await joplin.data.get(['notes', noteId], { fields: ['id', 'title'] });
		await joplin.data.delete(['notes', noteId]);
		return {
			success: true,
			message: `Note "${note.title}" deleted`,
			data: { id: noteId, title: note.title },
		};
	},
};

const moveNoteHandler: ActionHandler = {
	name: 'move_note',
	description:
		'Move a note to a different notebook. Use list_notebooks to find the target notebook ID.',
	parameters: {
		type: 'object',
		properties: {
			noteId: {
				type: 'string',
				description: 'ID of the note to move. If omitted, moves the currently selected note.',
			},
			targetNotebookId: {
				type: 'string',
				description: 'ID of the notebook to move the note into.',
			},
		},
		required: ['targetNotebookId'],
	},
	execute: async (args, context) => {
		const noteId = (args.noteId as string) || context.currentNoteId;
		if (!noteId) {
			return { success: false, message: 'No note ID provided and no note is selected' };
		}
		const note = await joplin.data.get(['notes', noteId], { fields: ['title'] });
		await joplin.data.put(['notes', noteId], null, {
			parent_id: args.targetNotebookId as string,
		});
		return {
			success: true,
			message: `Note "${note.title}" moved`,
			data: { noteId, targetNotebookId: args.targetNotebookId },
		};
	},
};

const searchNotesHandler: ActionHandler = {
	name: 'search_notes',
	description: 'Search for notes in Joplin by text query. Returns matching note titles and IDs.',
	parameters: {
		type: 'object',
		properties: {
			query: { type: 'string', description: 'Search query text' },
			limit: { type: 'number', description: 'Maximum number of results (default 10)' },
		},
		required: ['query'],
	},
	execute: async (args) => {
		const limit = (args.limit as number) || 10;
		const results = await joplin.data.get(['search'], {
			query: args.query as string,
			fields: ['id', 'title', 'parent_id'],
			limit,
		});
		const notes = (results.items || []) as Array<{
			id: string;
			title: string;
			parent_id: string;
		}>;
		return {
			success: true,
			message: `Found ${notes.length} note(s)`,
			data: {
				notes: notes.map((n) => ({ id: n.id, title: n.title, parentId: n.parent_id })),
			},
		};
	},
};

const listNotebooksHandler: ActionHandler = {
	name: 'list_notebooks',
	description: 'List all notebooks (folders) in Joplin. Returns notebook names and IDs.',
	parameters: {
		type: 'object',
		properties: {},
	},
	execute: async () => {
		const results = await joplin.data.get(['folders'], {
			fields: ['id', 'title', 'parent_id'],
		});
		const folders = (results.items || []) as Array<{
			id: string;
			title: string;
			parent_id: string;
		}>;
		return {
			success: true,
			message: `Found ${folders.length} notebook(s)`,
			data: {
				notebooks: folders.map((f) => ({
					id: f.id,
					title: f.title,
					parentId: f.parent_id,
				})),
			},
		};
	},
};

const createNotebookHandler: ActionHandler = {
	name: 'create_notebook',
	description:
		'Create a new notebook (folder) in Joplin. Optionally nest it under a parent notebook.',
	parameters: {
		type: 'object',
		properties: {
			title: { type: 'string', description: 'Name of the new notebook' },
			parentId: {
				type: 'string',
				description: 'ID of the parent notebook for nesting (optional)',
			},
		},
		required: ['title'],
	},
	execute: async (args) => {
		const folder = await joplin.data.post(['folders'], null, {
			title: args.title as string,
			parent_id: args.parentId as string | undefined,
		});
		return {
			success: true,
			message: `Notebook "${folder.title}" created`,
			data: { id: folder.id, title: folder.title },
		};
	},
};

const addTagHandler: ActionHandler = {
	name: 'add_tag',
	description: 'Add a tag to the currently selected note. Creates the tag if it does not exist.',
	parameters: {
		type: 'object',
		properties: {
			tag: { type: 'string', description: 'Tag name to add' },
			noteId: {
				type: 'string',
				description: 'ID of the note to tag. If omitted, tags the currently selected note.',
			},
		},
		required: ['tag'],
	},
	execute: async (args, context) => {
		const noteId = (args.noteId as string) || context.currentNoteId;
		if (!noteId) {
			return { success: false, message: 'No note ID provided and no note is selected' };
		}
		const tagName = (args.tag as string).toLowerCase().trim();
		const existingTags = await joplin.data.get(['tags'], { fields: ['id', 'title'] });
		const allTags = (existingTags.items || []) as Array<{ id: string; title: string }>;
		let tag = allTags.find((t) => t.title.toLowerCase() === tagName);
		if (!tag) {
			tag = await joplin.data.post(['tags'], null, { title: tagName });
		}
		await joplin.data.post(['tags', tag.id, 'notes'], null, { id: noteId });
		return { success: true, message: `Tag "${tagName}" added to note` };
	},
};

const removeTagHandler: ActionHandler = {
	name: 'remove_tag',
	description: 'Remove a tag from a note.',
	parameters: {
		type: 'object',
		properties: {
			tag: { type: 'string', description: 'Tag name to remove' },
			noteId: {
				type: 'string',
				description:
					'ID of the note to untag. If omitted, untags the currently selected note.',
			},
		},
		required: ['tag'],
	},
	execute: async (args, context) => {
		const noteId = (args.noteId as string) || context.currentNoteId;
		if (!noteId) {
			return { success: false, message: 'No note ID provided and no note is selected' };
		}
		const tagName = (args.tag as string).toLowerCase().trim();
		const existingTags = await joplin.data.get(['tags'], { fields: ['id', 'title'] });
		const allTags = (existingTags.items || []) as Array<{ id: string; title: string }>;
		const tag = allTags.find((t) => t.title.toLowerCase() === tagName);
		if (!tag) {
			return { success: false, message: `Tag "${tagName}" not found` };
		}
		await joplin.data.delete(['tags', tag.id, 'notes', noteId]);
		return { success: true, message: `Tag "${tagName}" removed from note` };
	},
};

const listTagsHandler: ActionHandler = {
	name: 'list_tags',
	description:
		'List tags. If a noteId is provided, lists tags for that note. Otherwise lists all tags in Joplin.',
	parameters: {
		type: 'object',
		properties: {
			noteId: {
				type: 'string',
				description:
					'ID of the note to list tags for (optional). If omitted, lists all tags.',
			},
		},
	},
	execute: async (args) => {
		const noteId = args.noteId as string | undefined;
		const path = noteId ? ['notes', noteId, 'tags'] : ['tags'];
		const results = await joplin.data.get(path, { fields: ['id', 'title'] });
		const tags = (results.items || []) as Array<{ id: string; title: string }>;
		return {
			success: true,
			message: `Found ${tags.length} tag(s)`,
			data: { tags: tags.map((t) => ({ id: t.id, title: t.title })) },
		};
	},
};

const handlers: ActionHandler[] = [
	createNoteHandler,
	getNoteHandler,
	updateNoteHandler,
	deleteNoteHandler,
	moveNoteHandler,
	searchNotesHandler,
	listNotebooksHandler,
	createNotebookHandler,
	addTagHandler,
	removeTagHandler,
	listTagsHandler,
];

const handlerMap = new Map(handlers.map((h) => [h.name, h]));

export const getActionHandlers = (): ActionHandler[] => handlers;

export const executeAction = async (
	name: string,
	args: Record<string, unknown>,
	context: ActionContext,
): Promise<ActionResult> => {
	const handler = handlerMap.get(name);
	if (!handler) {
		return { success: false, message: `Unknown action: ${name}` };
	}
	return handler.execute(args, context);
};
