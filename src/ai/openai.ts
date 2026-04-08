import * as https from 'https';

export async function callOpenAI(
	apiKey: string,
	model: string,
	systemPrompt: string,
	userPrompt: string,
): Promise<string> {
	const body = JSON.stringify({
		model,
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		],
		temperature: 0.3,
	});

	return new Promise((resolve, reject) => {
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
							reject(new Error(parsed.error.message || 'OpenAI API error'));
							return;
						}
						const text = parsed.choices?.[0]?.message?.content;
						if (!text) {
							reject(new Error('Empty response from OpenAI'));
							return;
						}
						resolve(text);
					} catch (e) {
						reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
					}
				});
			},
		);

		req.on('error', (e: Error) => reject(new Error(`OpenAI request failed: ${e.message}`)));
		req.write(body);
		req.end();
	});
}
