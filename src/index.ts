import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { initSettings } from './settings';
import { initPanel, togglePanel, setEditorSelection, triggerAskAI } from './panel';

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
					return joplin.settings
						.globalValues(['plugin-net.roxl.joplin-notion.notion.blockEditor.active'])
						.then(([active]: unknown[]) => ({ active: Boolean(active) }))
						.catch(() => ({ active: false }));
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

		await joplin.views.menuItems.create(
			'editWithAIMenuItem',
			'editWithAI',
			MenuItemLocation.Tools,
			{ accelerator: 'CmdOrCtrl+Shift+A' },
		);

		await joplin.views.toolbarButtons.create(
			'toggleSideBarBtn',
			'toggleSideBar',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.toolbarButtons.create(
			'toggleNoteListBtn',
			'toggleNoteList',
			ToolbarButtonLocation.NoteToolbar,
		);

		await joplin.views.toolbarButtons.create(
			'editWithAIBtn',
			'editWithAI',
			ToolbarButtonLocation.NoteToolbar,
		);
	},
});
