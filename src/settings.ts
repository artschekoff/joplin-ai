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
	webSearchModel: 'webSearchModel',
	kieApiKey: 'kieApiKey',
	imageGenModel: 'imageGenModel',
	fileMaxSizeMb: 'fileMaxSizeMb',
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
			value: 'gpt-5.4',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			isEnum: true,
			label: 'OpenAI Model',
			description:
				'All OpenAI models support tool calling. Web search requires enabling it separately (uses gpt-4o-search-preview).',
			options: {
				'gpt-5.4': 'GPT-5.4 — flagship, 1M context, tool calling',
				'gpt-5.4-mini': 'GPT-5.4 Mini — fast, 400K context, tool calling',
				'gpt-5.4-nano': 'GPT-5.4 Nano — fastest, 400K context, tool calling',
				'gpt-4.1': 'GPT-4.1 — 1M context, tool calling',
				'gpt-4.1-mini': 'GPT-4.1 Mini — fast, 1M context, tool calling',
				'gpt-4.1-nano': 'GPT-4.1 Nano — fastest, 1M context, tool calling',
				o3: 'o3 — reasoning, 200K context, tool calling',
				'o4-mini': 'o4-mini — fast reasoning, 200K context, tool calling',
				'gpt-4o': 'GPT-4o — tool calling',
				'gpt-4o-mini': 'GPT-4o Mini — tool calling',
				'gpt-4-turbo': 'GPT-4 Turbo — tool calling',
				'gpt-3.5-turbo': 'GPT-3.5 Turbo — tool calling',
				'codex-mini-latest': 'Codex Mini — tool calling',
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
			description:
				'All Claude models support tool calling. Web search requires enabling it separately (uses OpenAI gpt-4o-search-preview).',
			options: {
				'claude-opus-4-20250514': 'Claude Opus 4 — tool calling',
				'claude-sonnet-4-20250514': 'Claude Sonnet 4 — tool calling',
				'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet — tool calling',
				'claude-3-haiku-20240307': 'Claude 3 Haiku — tool calling',
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
			description:
				'Sonar models have native built-in web search. Third-party models (Claude, GPT, Gemini, etc.) are accessed via the Perplexity Agent API with tool calling support.',
			options: {
				sonar: 'Sonar — native web search + tool calling',
				'sonar-pro': 'Sonar Pro — native web search',
				'sonar-reasoning-pro': 'Sonar Reasoning Pro — native web search',
				'sonar-deep-research': 'Sonar Deep Research — native web search',
				'anthropic/claude-opus-4-6': 'Claude Opus 4.6 — tool calling (via Perplexity)',
				'anthropic/claude-sonnet-4-6': 'Claude Sonnet 4.6 — tool calling (via Perplexity)',
				'anthropic/claude-haiku-4-5': 'Claude Haiku 4.5 — tool calling (via Perplexity)',
				'openai/gpt-5.4': 'GPT-5.4 — tool calling (via Perplexity)',
				'openai/gpt-5.2': 'GPT-5.2 — tool calling (via Perplexity)',
				'openai/gpt-5.1': 'GPT-5.1 — tool calling (via Perplexity)',
				'openai/gpt-5-mini': 'GPT-5 Mini — tool calling (via Perplexity)',
				'google/gemini-3.1-pro-preview': 'Gemini 3.1 Pro — tool calling (via Perplexity)',
				'google/gemini-3-flash-preview': 'Gemini 3.0 Flash — tool calling (via Perplexity)',
				'xai/grok-4-1-fast-non-reasoning': 'Grok 4.1 — tool calling (via Perplexity)',
				'nvidia/nemotron-3-super-120b-a12b': 'Nemotron 3 Super — tool calling (via Perplexity)',
			},
		},

		[SETTING_KEYS.webSearchEnabled]: {
			value: false,
			type: SettingItemType.Bool,
			section: 'aiAssistant',
			public: true,
			label: 'Enable Web Search',
			description:
				'Allow the AI to delegate web searches to a dedicated search model when your primary model does not support web search natively. Not needed for Perplexity — all Perplexity models have built-in web search. Select the search model below.',
		},

		[SETTING_KEYS.webSearchModel]: {
			value: 'openai:gpt-4o-search-preview',
			type: SettingItemType.String,
			section: 'aiAssistant',
			public: true,
			isEnum: true,
			label: 'Web Search Model',
			description:
				'Model used for web searches when your primary model (OpenAI / Claude) needs one. Perplexity models use native built-in search and do not use this setting. OpenAI option requires your OpenAI API key; Perplexity options require your Perplexity API key.',
			options: {
				'openai:gpt-4o-search-preview': 'OpenAI — gpt-4o-search-preview (OpenAI key)',
				'perplexity:sonar': 'Perplexity — Sonar (Perplexity key)',
				'perplexity:sonar-pro': 'Perplexity — Sonar Pro (Perplexity key)',
				'perplexity:sonar-reasoning-pro': 'Perplexity — Sonar Reasoning Pro (Perplexity key)',
				'perplexity:sonar-deep-research': 'Perplexity — Sonar Deep Research (Perplexity key)',
			},
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

		[SETTING_KEYS.fileMaxSizeMb]: {
			value: 10,
			type: SettingItemType.Int,
			section: 'aiAssistant',
			public: true,
			label: 'Max File Attachment Size (MB)',
			description:
				'Maximum file size allowed for attachments (in megabytes). Files exceeding this limit will be rejected.',
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
