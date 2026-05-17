import joplin from 'api';
import { MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { initSettings } from './settings';
import { initPanel, togglePanel, executeWithSelection } from './panel';

let lastProcessedAskAITs = 0;

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

		await joplin.settings.onChange(async () => {
			try {
				const raw = await joplin.settings.globalValue('notion.askAI.request');
				if (!raw) return;
				const parsed = JSON.parse(raw as string);
				const { text, prompt, ts } = parsed as { text?: string; prompt?: string; ts?: number };
				if (!ts || ts <= lastProcessedAskAITs) return;
				if (!text?.trim() || !prompt?.trim()) return;
				lastProcessedAskAITs = ts;
				await executeWithSelection(text, prompt);
			} catch {
				// ignore parse errors or missing setting
			}
		});

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
