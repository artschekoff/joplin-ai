import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { initSettings } from './settings';
import {
	initPanel,
	togglePanel,
	toggleBlockEditorPane,
	getBlockEditorEnabled,
	setEditorSelection,
	triggerAskAI,
	shareCurrentNote,
} from './panel';

joplin.plugins.register({
	onStart: async function () {
		try {
			await initSettings();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('AI Assistant: settings registration failed:', msg);
		}

		try {
			await initPanel();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('AI Assistant: panel initialization failed:', msg);
		}

		try {
			await joplin.contentScripts.register(
				ContentScriptType.CodeMirrorPlugin,
				'editorHider',
				'./contentScripts/editorHider.js',
			);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await joplin.contentScripts.onMessage('editorHider', (message: any) => {
				if (message?.type === 'getBlockEditorState') {
					return { active: getBlockEditorEnabled() };
				}
				if (message?.type === 'selectionChange') {
					const text = typeof message.text === 'string' ? message.text : '';
					setEditorSelection(text);
				}
				if (message?.type === 'askAI') {
					const text = typeof message.text === 'string' ? message.text : '';
					triggerAskAI(text);
				}
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error('AI Assistant: content script registration failed:', msg);
		}

		await joplin.commands.register({
			name: 'editWithAI',
			label: 'Edit with AI',
			iconName: 'fas fa-robot',
			execute: async () => {
				await togglePanel();
			},
		});

		await joplin.commands.register({
			name: 'enableBlockEditor',
			label: 'Toggle Block Editor',
			iconName: 'fas fa-th-large',
			execute: async () => {
				await toggleBlockEditorPane();
			},
		});

		await joplin.views.menuItems.create(
			'editWithAIMenuItem',
			'editWithAI',
			MenuItemLocation.Tools,
			{ accelerator: 'CmdOrCtrl+Shift+A' },
		);

		await joplin.views.menuItems.create(
			'enableBlockEditorMenuItem',
			'enableBlockEditor',
			MenuItemLocation.Tools,
			{ accelerator: 'CmdOrCtrl+Shift+B' },
		);

		await joplin.views.toolbarButtons.create(
			'editWithAIBtn',
			'editWithAI',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.toolbarButtons.create(
			'enableBlockEditorBtn',
			'enableBlockEditor',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.commands.register({
			name: 'shareNoteAsText',
			label: 'Share note — Email as text',
			iconName: 'fas fa-envelope',
			execute: async () => {
				try {
					await shareCurrentNote('text');
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to share note as text.';
					await joplin.views.dialogs.showMessageBox(msg);
				}
			},
		});

		await joplin.commands.register({
			name: 'shareNoteAsPdf',
			label: 'Export note as PDF',
			iconName: 'fas fa-file-pdf',
			execute: async () => {
				try {
					await shareCurrentNote('pdf');
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to export note as PDF.';
					await joplin.views.dialogs.showMessageBox(msg);
				}
			},
		});

		await joplin.commands.register({
			name: 'exportNoteAsDoc',
			label: 'Export note as DOCX',
			iconName: 'fas fa-file-word',
			execute: async () => {
				try {
					await shareCurrentNote('doc');
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to export note as DOCX.';
					await joplin.views.dialogs.showMessageBox(msg);
				}
			},
		});

		await joplin.commands.register({
			name: 'exportNoteAsRtf',
			label: 'Export note as RTF',
			iconName: 'fas fa-file-alt',
			execute: async () => {
				try {
					await shareCurrentNote('rtf');
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to export note as RTF.';
					await joplin.views.dialogs.showMessageBox(msg);
				}
			},
		});

		await joplin.views.menuItems.create(
			'shareNoteAsTextMenuItem',
			'shareNoteAsText',
			MenuItemLocation.Tools,
		);

		await joplin.views.menuItems.create(
			'shareNoteAsPdfMenuItem',
			'shareNoteAsPdf',
			MenuItemLocation.Tools,
		);

		await joplin.views.menuItems.create(
			'exportNoteAsDocMenuItem',
			'exportNoteAsDoc',
			MenuItemLocation.Tools,
		);

		await joplin.views.menuItems.create(
			'exportNoteAsRtfMenuItem',
			'exportNoteAsRtf',
			MenuItemLocation.Tools,
		);

		await joplin.views.toolbarButtons.create(
			'shareNoteAsTextBtn',
			'shareNoteAsText',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.toolbarButtons.create(
			'shareNoteAsPdfBtn',
			'shareNoteAsPdf',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.toolbarButtons.create(
			'exportNoteAsDocBtn',
			'exportNoteAsDoc',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.toolbarButtons.create(
			'exportNoteAsRtfBtn',
			'exportNoteAsRtf',
			ToolbarButtonLocation.NoteToolbar,
		);
	},
});
