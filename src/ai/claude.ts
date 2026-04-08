import * as https from 'https';

export async function callClaude(
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
): Promise<string> {
	const body = JSON.stringify({
		model,
		max_tokens: 4096,
		system: systemPrompt,
		messages: [{ role: 'user', content: userPrompt }],
	});

	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: 'api.anthropic.com',
				path: '/v1/messages',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
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
							reject(new Error(parsed.error.message || 'Claude API error'));
							return;
						}
						const text = parsed.content?.[0]?.text;
						if (!text) {
							reject(new Error('Empty response from Claude'));
							return;
						}
						resolve(text);
					} catch (e) {
						reject(new Error(`Failed to parse Claude response: ${e.message}`));
					}
				});
			},
		);

		req.on('error', (e: Error) => reject(new Error(`Claude request failed: ${e.message}`)));
		req.write(body);
		req.end();
	});
}
