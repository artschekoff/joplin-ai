import joplin from 'api';
import { MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { initSettings } from './settings';
import { initPanel, togglePanel } from './panel';

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
	},
});
