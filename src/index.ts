import joplin from 'api';
import { MenuItemLocation } from 'api/types';
import { initSettings } from './settings';
import { initPanel, togglePanel } from './panel';

joplin.plugins.register({
	onStart: async function () {
		await initSettings();
		await initPanel();

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
	},
});
