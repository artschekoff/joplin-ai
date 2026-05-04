import * as fs from 'fs';
import * as path from 'path';
import joplin from 'api';
import { ActionResult, ActionContext, ActionHandler } from './types';
import { performWebSearch } from '../ai/web-search';
import { performPerplexityWebSearch } from '../ai/perplexity';
import { generateImage, downloadImageToFile } from '../ai/image-gen';

export const READ_ONLY_ACTIONS = new Set([
	'get_note',
	'open_note',
	'search_notes',
	'list_notebooks',
	'list_tags',
	'web_search',
]);

export const EDIT_ACTIONS = new Set([...READ_ONLY_ACTIONS, 'update_note']);

const MODE_LABELS: Record<string, string> = {
	ask: 'Ask mode',
	edit: 'Edit mode',
};

const isActionAllowed = (actionName: string, workMode?: string): boolean => {
	if (!workMode || workMode === 'agent') return true;
	const allowed = workMode === 'ask' ? READ_ONLY_ACTIONS : EDIT_ACTIONS;
	return allowed.has(actionName);
};

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
				description: 'ID of the notebook to create the note in. Use list_notebooks to find IDs.',
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

const openNoteHandler: ActionHandler = {
	name: 'open_note',
	description:
		'Open a note in Joplin by navigating to it in the editor. Use after search_notes to let the user view/edit the found note directly.',
	parameters: {
		type: 'object',
		properties: {
			noteId: {
				type: 'string',
				description: 'ID of the note to open. If omitted, opens the currently selected note.',
			},
		},
	},
	execute: async (args, context) => {
		const noteId = (args.noteId as string) || context.currentNoteId;
		if (!noteId) {
			return { success: false, message: 'No note ID provided and no note is selected' };
		}
		try {
			const note = await joplin.data.get(['notes', noteId], { fields: ['id', 'title'] });
			if (!note) {
				return { success: false, message: `Note "${noteId}" not found` };
			}
			await joplin.commands.execute('openNote', noteId);
			return {
				success: true,
				message: `Opened note "${note.title}"`,
				data: { id: note.id, title: note.title },
			};
		} catch {
			return { success: false, message: `Note "${noteId}" not found` };
		}
	},
};

const updateNoteHandler: ActionHandler = {
	name: 'update_note',
	description:
		'Update a note by ID, or the currently selected note if no noteId is provided. ' +
		'Use "body" to edit the note text/content. Use "title" ONLY when renaming the note name in the notes list. ' +
		'Provide only the fields you want to change.',
	parameters: {
		type: 'object',
		properties: {
			noteId: {
				type: 'string',
				description: 'ID of the note to update. If omitted, updates the currently selected note.',
			},
			title: {
				type: 'string',
				description:
					'New note name shown in the notes list (for renaming only — do NOT use this to edit text content inside the note).',
			},
			body: {
				type: 'string',
				description:
					'Complete new Markdown text content of the note. Use this to edit any text, fix typos, or update content inside the note.',
			},
		},
	},
	execute: async (args, context) => {
		const noteId = (args.noteId as string) || context.currentNoteId;
		if (!noteId) {
			return { success: false, message: 'No note ID provided and no note is selected' };
		}
		const updates: Record<string, unknown> = {};
		if (args.title !== undefined && context.workMode !== 'edit') updates.title = args.title;
		if (args.body !== undefined)
			updates.body = (args.body as string).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		if (Object.keys(updates).length === 0) {
			if (args.title !== undefined && context.workMode === 'edit') {
				return {
					success: false,
					message: 'Note title is read-only in Edit mode. Only the body can be modified.',
				};
			}
			return { success: false, message: 'No fields provided to update' };
		}
		let oldBody: string | undefined;
		const needsExistingBody =
			typeof updates.body === 'string' &&
			(context.onPendingEdit || (context.isSelection && context.selectionText));
		if (needsExistingBody) {
			const existingNote = await joplin.data.get(['notes', noteId], { fields: ['body'] });
			oldBody = (existingNote?.body ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		}
		if (context.isSelection && context.selectionText && typeof updates.body === 'string') {
			const fullBody: string = oldBody ?? '';
			const aiBody = updates.body as string;
			const selIdx = fullBody.indexOf(context.selectionText);
			const aiSentFragment = selIdx !== -1 && aiBody.length < fullBody.length * 0.8;
			if (aiSentFragment) {
				updates.body =
					fullBody.substring(0, selIdx) +
					aiBody +
					fullBody.substring(selIdx + context.selectionText.length);
			}
		}
		const isPendingBodyEdit =
			typeof updates.body === 'string' && !!context.onPendingEdit && oldBody !== undefined;
		if (!isPendingBodyEdit) {
			await joplin.data.put(['notes', noteId], null, updates);
		}
		let noteTitle = context.currentNoteTitle;
		if (args.noteId) {
			const note = await joplin.data.get(['notes', noteId], { fields: ['title'] });
			noteTitle = note?.title ?? noteId;
		}
		if (isPendingBodyEdit) {
			context.onPendingEdit!({
				noteId,
				noteTitle: noteTitle ?? noteId,
				oldBody: oldBody as string,
				newBody: updates.body as string,
			});
		}
		const parts = Object.keys(updates).join(' and ');
		return {
			success: true,
			message: isPendingBodyEdit
				? `Note "${noteTitle}" ${parts} ready — review the diff below`
				: `Note "${noteTitle}" ${parts} updated`,
			data: { id: noteId, title: noteTitle },
		};
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
				description: 'ID of the note to delete. If omitted, deletes the currently selected note.',
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
			data: { noteId, title: note.title, targetNotebookId: args.targetNotebookId },
		};
	},
};

const searchNotesHandler: ActionHandler = {
	name: 'search_notes',
	description:
		'Search for notes in Joplin using its full query syntax. Supports plain keywords (searches title and body), ' +
		'phrases ("exact phrase"), prefix wildcards (swim*), and filters: ' +
		'title:word, body:word, tag:name, notebook:name, created:YYYYMMDD, updated:YYYYMMDD, ' +
		'type:note|todo, iscompleted:0|1, resource:mime/type, sourceurl:url. ' +
		'Negate with - prefix (-tag:spam). Use any:1 for OR logic (default is AND). ' +
		'Date filters accept relative values: created:day-7, updated:year-0. ' +
		'Tag and notebook filters support wildcards: tag:be*ful, notebook:work*. ' +
		'Returns matching note titles and IDs.',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description:
					'Joplin search query. Examples: "budget meeting", title:recipe tag:favorite, ' +
					'notebook:Work created:day-7, type:todo iscompleted:0, ' +
					'any:1 tag:urgent tag:important, "project plan" -tag:archived',
			},
			limit: { type: 'number', description: 'Maximum number of results (default 10)' },
		},
		required: ['query'],
	},
	execute: async (args) => {
		const limit = (args.limit as number) ?? 10;
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
		return {
			success: true,
			message: `Tag "${tagName}" added to note`,
			data: { noteId, tag: tagName },
		};
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
				description: 'ID of the note to untag. If omitted, untags the currently selected note.',
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
		return {
			success: true,
			message: `Tag "${tagName}" removed from note`,
			data: { noteId, tag: tagName },
		};
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
				description: 'ID of the note to list tags for (optional). If omitted, lists all tags.',
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

const webSearchHandler: ActionHandler = {
	name: 'web_search',
	description:
		'Search the web for current information (OpenAI gpt-4o-search-preview). Returns results with source citations. Use when the user asks about recent events, needs up-to-date data, or wants information beyond what is in their notes. Requires "Enable Web Search" setting and an OpenAI API key.',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'The search query to look up on the web.',
			},
		},
		required: ['query'],
	},
	execute: async (args, context): Promise<ActionResult> => {
		if (!context.webSearchEnabled) {
			return {
				success: false,
				message:
					'Web search is not available. Enable it in Settings → AI Assistant → Enable Web Search, then pick a Web Search Model. Not needed for Perplexity — it has native built-in web search.',
			};
		}
		const webSearchModel = context.webSearchModel ?? 'openai:gpt-4o-search-preview';
		const colonIdx = webSearchModel.indexOf(':');
		const searchProvider = colonIdx !== -1 ? webSearchModel.substring(0, colonIdx) : 'openai';
		const searchModel = colonIdx !== -1 ? webSearchModel.substring(colonIdx + 1) : webSearchModel;
		const query = args.query as string;
		try {
			if (searchProvider === 'perplexity') {
				if (!context.perplexityApiKey?.trim()) {
					return {
						success: false,
						message:
							'Web search with Perplexity requires a Perplexity API key. Add it in Settings → AI Assistant → Perplexity API Key.',
					};
				}
				const result = await performPerplexityWebSearch(
					context.perplexityApiKey,
					searchModel,
					query,
				);
				return {
					success: true,
					message: `Web search completed via Perplexity ${searchModel} for "${query}"`,
					data: {
						content: result.content,
						citations: result.citations,
						searchProvider: 'perplexity',
						searchModel,
					},
				};
			}
			if (!context.openaiApiKey?.trim()) {
				return {
					success: false,
					message:
						'Web search with OpenAI requires an OpenAI API key. Add it in Settings → AI Assistant → OpenAI API Key.',
				};
			}
			const result = await performWebSearch(context.openaiApiKey, query);
			return {
				success: true,
				message: `Web search completed via OpenAI for "${query}"`,
				data: {
					content: result.content,
					citations: result.citations,
					searchProvider: 'openai',
					searchModel: 'gpt-4o-search-preview',
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			return { success: false, message: `Web search failed: ${message}` };
		}
	},
};

const generateImageHandler: ActionHandler = {
	name: 'generate_image',
	description:
		'Generate an image from a text description using AI (Kie.ai). ' +
		'The image is downloaded at full quality and attached as a Joplin resource to the specified note. ' +
		'Include visual style hints (e.g. "watercolor", "photorealistic", "anime") in the style parameter.',
	parameters: {
		type: 'object',
		properties: {
			prompt: {
				type: 'string',
				description: 'Detailed description of the image to generate.',
			},
			noteId: {
				type: 'string',
				description: 'ID of the note to insert the image into. If omitted, uses the current note.',
			},
			aspectRatio: {
				type: 'string',
				enum: [
					'1:1',
					'3:2',
					'2:3',
					'3:4',
					'4:3',
					'4:5',
					'5:4',
					'9:16',
					'16:9',
					'21:9',
					'1:4',
					'1:8',
					'4:1',
					'8:1',
					'auto',
				],
				description:
					'Aspect ratio of the generated image. Supported ratios vary by model — the API validates and returns an error if the chosen ratio is not supported. Nano Banana 2 defaults to "auto".',
			},
			quality: {
				type: 'string',
				enum: ['medium', 'high'],
				description: 'Image quality — medium is faster, high is more detailed (default medium).',
			},
			style: {
				type: 'string',
				description:
					'Visual style for the image (e.g. "watercolor", "photorealistic", "pixel art", "oil painting", "anime"). Optional.',
			},
		},
		required: ['prompt'],
	},
	execute: async (args, context): Promise<ActionResult> => {
		if (!context.kieApiKey?.trim()) {
			return {
				success: false,
				message: 'Kie.ai API key is not configured. Go to Settings → AI Assistant to set it up.',
			};
		}
		const noteId = (args.noteId as string) || context.currentNoteId;
		if (!noteId) {
			return { success: false, message: 'No note ID provided and no note is selected' };
		}
		let tempFilePath: string | null = null;
		try {
			const model = context.imageGenModel ?? 'gpt-image/1.5-text-to-image';
			const onProgress = context.onImageProgress
				? (p: { attempt: number; maxAttempts: number; state: string }) => {
						const pct = Math.round(((p.attempt + 1) / p.maxAttempts) * 100);
						context.onImageProgress!({ progress: pct, state: p.state });
					}
				: undefined;
			const result = await generateImage(
				context.kieApiKey,
				{
					prompt: args.prompt as string,
					model,
					aspectRatio: args.aspectRatio as string | undefined,
					quality: args.quality as string | undefined,
					style: args.style as string | undefined,
				},
				{ intervalMs: 3000, maxAttempts: 60, onProgress },
			);
			const imageUrl = result.imageUrls[0];
			if (imageUrl) {
				const downloaded = await downloadImageToFile(imageUrl);
				tempFilePath = downloaded.filePath;
				const resource = await joplin.data.post(
					['resources'],
					null,
					{ title: downloaded.filename, mime: downloaded.mimeType },
					[{ path: downloaded.filePath }],
				);
				const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
				const imageMarkdown = `\n\n![${args.prompt}](:/${resource.id})`;
				await joplin.data.put(['notes', noteId], null, {
					body: (note.body ?? '') + imageMarkdown,
				});
				return {
					success: true,
					message: `Image generated and attached to note`,
					data: {
						taskId: result.taskId,
						resourceId: resource.id,
						noteId,
					},
				};
			}
			return {
				success: true,
				message: `Image generated but no URL returned`,
				data: { taskId: result.taskId, noteId },
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown error';
			return { success: false, message: `Image generation failed: ${message}` };
		} finally {
			if (tempFilePath) {
				try {
					fs.unlinkSync(tempFilePath);
					fs.rmdirSync(path.dirname(tempFilePath));
				} catch {
					// best-effort cleanup
				}
			}
		}
	},
};

const removeResourceHandler: ActionHandler = {
	name: 'remove_resource',
	description:
		'Remove an image or attachment from a note. Strips the markdown reference from the note body and deletes the resource from Joplin. ' +
		'Use get_note first to find the resource IDs in the note body (they appear as ![alt](:/resourceId)).',
	parameters: {
		type: 'object',
		properties: {
			noteId: {
				type: 'string',
				description:
					'ID of the note to remove the resource from. If omitted, uses the currently selected note.',
			},
			resourceId: {
				type: 'string',
				description:
					'ID of the resource to remove. Found in the note body as ![alt](:/RESOURCE_ID).',
			},
		},
		required: ['resourceId'],
	},
	execute: async (args, context): Promise<ActionResult> => {
		const noteId = (args.noteId as string) || context.currentNoteId;
		if (!noteId) {
			return { success: false, message: 'No note ID provided and no note is selected' };
		}
		const resourceId = args.resourceId as string;
		if (!resourceId?.trim()) {
			return { success: false, message: 'No resource ID provided' };
		}
		const note = await joplin.data.get(['notes', noteId], { fields: ['body'] });
		const body: string = note.body ?? '';
		const escapedId = resourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const refPattern = new RegExp(`\\n*!\\[[^\\]]*\\]\\(:/${escapedId}\\)\\n*`, 'g');
		const updatedBody = body
			.replace(refPattern, '\n\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		if (updatedBody !== body.trim()) {
			await joplin.data.put(['notes', noteId], null, { body: updatedBody });
		}
		try {
			await joplin.data.delete(['resources', resourceId]);
		} catch {
			// Resource may already be deleted or orphaned — proceed gracefully
		}
		return {
			success: true,
			message: `Resource removed from note`,
			data: { noteId, resourceId },
		};
	},
};

const handlers: ActionHandler[] = [
	createNoteHandler,
	getNoteHandler,
	openNoteHandler,
	updateNoteHandler,
	deleteNoteHandler,
	moveNoteHandler,
	searchNotesHandler,
	listNotebooksHandler,
	createNotebookHandler,
	addTagHandler,
	removeTagHandler,
	listTagsHandler,
	webSearchHandler,
	generateImageHandler,
	removeResourceHandler,
];

const handlerMap = new Map(handlers.map((h) => [h.name, h]));

export const getActionHandlers = (): ActionHandler[] => handlers;

export const executeAction = async (
	name: string,
	args: Record<string, unknown>,
	context: ActionContext,
): Promise<ActionResult> => {
	if (!isActionAllowed(name, context.workMode)) {
		const label = MODE_LABELS[context.workMode ?? ''] ?? context.workMode;
		return {
			success: false,
			message: `Action "${name}" is not allowed in ${label}. Switch to Agent or Edit mode first.`,
		};
	}
	const handler = handlerMap.get(name);
	if (!handler) {
		return { success: false, message: `Unknown action: ${name}` };
	}
	return handler.execute(args, context);
};
