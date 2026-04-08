import joplin from 'api';
import { SettingItemType } from 'api/types';

export const SETTING_KEYS = {
	provider: 'aiProvider',
	openaiKey: 'openaiApiKey',
	openaiModel: 'openaiModel',
	claudeKey: 'claudeApiKey',
	claudeModel: 'claudeModel',
};

export async function initSettings() {
	await joplin.settings.registerSection('aiAssistant', {
		label: 'AI Assistant',
		iconName: 'fas fa-robot',
		description: 'Configure AI provider, API keys, and models for the Edit with AI feature.',
	});

	await joplin.settings.registerSettings({
		[SETTING_KEYS.provider]: {
			value: 'openai',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			isEnum: true,
			label: 'AI Provider',
			description: 'Select which AI provider to use.',
			options: {
				openai: 'OpenAI',
				claude: 'Claude (Anthropic)',
			},
		},

		[SETTING_KEYS.openaiKey]: {
			value: '',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			secure: true,
			label: 'OpenAI API Key',
			description: 'Your OpenAI API key (sk-...).',
		},

		[SETTING_KEYS.openaiModel]: {
			value: 'gpt-4o',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			isEnum: true,
			label: 'OpenAI Model',
			options: {
				'gpt-4o': 'GPT-4o',
				'gpt-4o-mini': 'GPT-4o Mini',
				'gpt-4-turbo': 'GPT-4 Turbo',
				'gpt-3.5-turbo': 'GPT-3.5 Turbo',
			},
		},

		[SETTING_KEYS.claudeKey]: {
			value: '',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			secure: true,
			label: 'Claude API Key',
			description: 'Your Anthropic API key.',
		},

		[SETTING_KEYS.claudeModel]: {
			value: 'claude-sonnet-4-20250514',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			isEnum: true,
			label: 'Claude Model',
			options: {
				'claude-sonnet-4-20250514': 'Claude Sonnet 4',
				'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
				'claude-3-haiku-20240307': 'Claude 3 Haiku',
			},
		},
	});
}
