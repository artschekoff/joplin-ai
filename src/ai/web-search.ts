import * as https from 'https';

export interface WebSearchCitation {
	url: string;
	title: string;
}

export interface WebSearchResult {
	content: string;
	citations: WebSearchCitation[];
}

interface SearchAnnotation {
	type: string;
	url: string;
	title: string;
	start_index: number;
	end_index: number;
}

const WEB_SEARCH_MODEL = 'gpt-4o-search-preview';

const REQUEST_TIMEOUT_MS = 30_000;

const makeSearchRequest = (apiKey: string, body: string): Promise<Record<string, unknown>> =>
	new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: 'api.openai.com',
				path: '/v1/chat/completions',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`,
				},
			},
			(res) => {
				let data = '';
				res.on('data', (chunk: Buffer) => {
					data += chunk.toString();
				});
				res.on('end', () => {
					try {
						const parsed = JSON.parse(data);
						if (parsed.error) {
							reject(new Error(parsed.error.message || 'OpenAI web search API error'));
							return;
						}
						resolve(parsed);
					} catch (e) {
						reject(
							new Error(`Failed to parse OpenAI web search response: ${(e as Error).message}`),
						);
					}
				});
			},
		);
		req.setTimeout(REQUEST_TIMEOUT_MS, () => {
			req.destroy();
			reject(new Error('OpenAI web search request timed out'));
		});
		req.on('error', (e: Error) =>
			reject(new Error(`OpenAI web search request failed: ${e.message}`)),
		);
		req.write(body);
		req.end();
	});

/** Search the web using OpenAI's search-preview model. */
export const performWebSearch = async (apiKey: string, query: string): Promise<WebSearchResult> => {
	if (!apiKey?.trim()) {
		throw new Error('OpenAI API key is required for web search');
	}
	if (!query?.trim()) {
		throw new Error('Search query cannot be empty');
	}

	const requestBody = {
		model: WEB_SEARCH_MODEL,
		messages: [
			{
				role: 'user',
				content: query,
			},
		],
	};

	const parsed = await makeSearchRequest(apiKey, JSON.stringify(requestBody));
	const choices = parsed.choices as Array<{
		message: {
			content?: string | null;
			annotations?: SearchAnnotation[];
		};
		finish_reason: string;
	}>;
	const choice = choices?.[0];
	if (!choice) {
		throw new Error('Empty response from OpenAI web search');
	}

	const message = choice.message;
	const annotations = (message.annotations ?? []).filter((a) => a.type === 'url_citation');
	const citations: WebSearchCitation[] = annotations.map((a) => ({
		url: a.url,
		title: a.title,
	}));

	return {
		content: message.content ?? '',
		citations,
	};
};
