import joplin from 'api';
import { MenuItemLocation, ToolbarButtonLocation } from 'api/types';
import { initSettings } from './settings';
import { initPanel, togglePanel, executeWithSelection } from './panel';

let lastProcessedAskAITs = 0;

// Joplin stores plugin settings under plugin-${pluginId}.${key} internally.
// globalValue() reads the key as-is (no prefix), so we must pass the full key.
const NOTION_ASK_AI_REQUEST_KEY = 'plugin-net.roxl.joplin-notion.notion.askAI.request';

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

		// settings.onChange only fires for this plugin's own settings, so we poll
		// globalValue to detect requests written by joplin-notion.
		setInterval(async () => {
			try {
				const raw = await joplin.settings.globalValue(NOTION_ASK_AI_REQUEST_KEY);
				if (!raw) return;
				const parsed = JSON.parse(raw as string);
				const { text, prompt, ts } = parsed as { text?: string; prompt?: string; ts?: number };
				if (!ts || ts <= lastProcessedAskAITs) return;
				if (!text?.trim() || !prompt?.trim()) return;
				lastProcessedAskAITs = ts;
				await executeWithSelection(text, prompt);
			} catch {
				// ignore parse/read errors
			}
		}, 300);

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
