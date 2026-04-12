import joplin from 'api';
import { SettingItemType } from 'api/types';

export const SETTING_KEYS = {
	provider: 'aiProvider',
	openaiKey: 'openaiApiKey',
	openaiModel: 'openaiModel',
	claudeKey: 'claudeApiKey',
	claudeModel: 'claudeModel',
	perplexityKey: 'perplexityApiKey',
	perplexityModel: 'perplexityModel',
	agentRoles: 'agentRoles',
	webSearchEnabled: 'webSearchEnabled',
	kieApiKey: 'kieApiKey',
	imageGenModel: 'imageGenModel',
};

export const initSettings = async () => {
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
				perplexity: 'Perplexity',
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
				'codex-mini-latest': 'Codex Mini',
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
				'claude-opus-4-20250514': 'Claude Opus 4',
				'claude-sonnet-4-20250514': 'Claude Sonnet 4',
				'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
				'claude-3-haiku-20240307': 'Claude 3 Haiku',
			},
		},

		[SETTING_KEYS.perplexityKey]: {
			value: '',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			secure: true,
			label: 'Perplexity API Key',
			description:
				'Your Perplexity API key (pplx-...). Get one at https://www.perplexity.ai/settings/api',
		},

		[SETTING_KEYS.perplexityModel]: {
			value: 'sonar',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			isEnum: true,
			label: 'Perplexity Model',
			options: {
				sonar: 'Sonar',
				'sonar-pro': 'Sonar Pro',
				'sonar-reasoning-pro': 'Sonar Reasoning Pro',
				'sonar-deep-research': 'Sonar Deep Research',
			},
		},

		[SETTING_KEYS.webSearchEnabled]: {
			value: false,
			type: SettingItemType.Bool,
			section: 'aiAssistant',
			public: true,
			label: 'Enable Web Search',
			description:
				'Allow the AI to search the web for current information. Requires an OpenAI API key (uses gpt-4o-search-preview). Additional API costs apply per search.',
		},

		[SETTING_KEYS.kieApiKey]: {
			value: '',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			secure: true,
			label: 'Kie.ai API Key',
			description: 'Your Kie.ai API key for image generation. Get one at https://kie.ai/api-key',
		},

		[SETTING_KEYS.imageGenModel]: {
			value: 'gpt-image/1.5-text-to-image',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			isEnum: true,
			label: 'Image Generation Model',
			description: 'Select the model used for AI image generation via Kie.ai.',
			options: {
				'gpt-image/1.5-text-to-image': 'GPT Image 1.5',
				'gpt4o-image': 'GPT-4o Image',
				'nano-banana-pro': 'Nano Banana Pro (Gemini)',
				'nano-banana-2': 'Nano Banana 2 (Gemini 4K)',
			},
		},

		[SETTING_KEYS.agentRoles]: {
			value: '[]',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: false,
			label: 'Agent Roles',
			description: 'JSON array of agent role definitions (managed via AI Assistant panel).',
		},
	});
};
