import * as os from 'os';

jest.mock('child_process', () => ({
	execFile: jest.fn(),
}));

import {
	buildTextMailtoUrl,
	buildPdfMailtoUrl,
	markdownToPlainText,
	MAX_BODY_LENGTH,
} from '../share-note';

describe('buildTextMailtoUrl', () => {
	it('builds a valid mailto URL with subject and body', () => {
		const actualUrl = buildTextMailtoUrl('My Note', 'Hello world');
		expect(actualUrl).toMatch(/^mailto:\?/);
		expect(actualUrl).toContain('subject=');
		expect(actualUrl).toContain('body=');
		expect(actualUrl).toContain(encodeURIComponent('My Note'));
		expect(actualUrl).toContain(encodeURIComponent('Hello world'));
	});

	it('encodes special characters in title and body', () => {
		const actualUrl = buildTextMailtoUrl('Note & Title', 'Body with "quotes" & <tags>');
		expect(actualUrl).toContain(encodeURIComponent('Note & Title'));
		expect(actualUrl).toContain(encodeURIComponent('Body with "quotes" & <tags>'));
	});

	it('truncates body text that exceeds MAX_BODY_LENGTH', () => {
		const longBody = 'a'.repeat(MAX_BODY_LENGTH + 500);
		const actualUrl = buildTextMailtoUrl('Title', longBody);
		const decoded = decodeURIComponent(actualUrl);
		const bodyMatch = decoded.match(/body=(.*)$/s);
		expect(bodyMatch).not.toBeNull();
		const bodyContent = bodyMatch![1];
		expect(bodyContent.length).toBeLessThanOrEqual(MAX_BODY_LENGTH + 50);
		expect(bodyContent).toContain('[…truncated');
	});

	it('does not truncate body within limit', () => {
		const shortBody = 'Short content';
		const actualUrl = buildTextMailtoUrl('Title', shortBody);
		expect(actualUrl).toContain(encodeURIComponent(shortBody));
		expect(actualUrl).not.toContain('truncated');
	});

	it('handles empty title and body', () => {
		const actualUrl = buildTextMailtoUrl('', '');
		expect(actualUrl).toMatch(/^mailto:\?/);
	});
});

describe('markdownToPlainText', () => {
	it('strips heading markers from headings', () => {
		const inputMarkdown = '# Heading One\n## Heading Two\n### Level Three';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('#');
		expect(actualText).toContain('Heading One');
		expect(actualText).toContain('Heading Two');
		expect(actualText).toContain('Level Three');
	});

	it('strips bold markers from bold text', () => {
		const inputMarkdown = 'This is **bold text** here.';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('**');
		expect(actualText).toContain('bold text');
	});

	it('strips italic markers from italic text', () => {
		const inputMarkdown = 'This is *italic* and _also italic_.';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('*italic*');
		expect(actualText).not.toContain('_also italic_');
		expect(actualText).toContain('italic');
		expect(actualText).toContain('also italic');
	});

	it('strips inline code backticks but keeps code content', () => {
		const inputMarkdown = 'Call `myFunction()` to proceed.';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('`');
		expect(actualText).toContain('myFunction()');
	});

	it('strips code fence markers but keeps code content', () => {
		const inputMarkdown = '```javascript\nconsole.log("hello");\n```';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('```');
		expect(actualText).toContain('console.log');
	});

	it('converts bullet list items to bullet character •', () => {
		const inputMarkdown = '- First item\n- Second item\n- Third item';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).toContain('• First item');
		expect(actualText).toContain('• Second item');
		expect(actualText).toContain('• Third item');
	});

	it('converts blockquotes to indented quoted text', () => {
		const inputMarkdown = '> This is a quote.';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toMatch(/^>/m);
		expect(actualText).toContain('This is a quote.');
	});

	it('converts links to text followed by URL in parentheses', () => {
		const inputMarkdown = 'Visit [Google](https://google.com) for more.';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('[Google]');
		expect(actualText).toContain('Google');
		expect(actualText).toContain('https://google.com');
	});

	it('converts horizontal rules to a visible divider line', () => {
		const inputMarkdown = 'Before\n---\nAfter';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('---');
		expect(actualText).toContain('Before');
		expect(actualText).toContain('After');
	});

	it('renders h1 heading with an underline of equals signs', () => {
		const inputMarkdown = '# Project Overview';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('#');
		expect(actualText).toContain('Project Overview');
		expect(actualText).toMatch(/={3,}/);
	});

	it('renders h2 heading with an underline of dashes', () => {
		const inputMarkdown = '## Section Title';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('#');
		expect(actualText).toContain('Section Title');
		expect(actualText).toMatch(/-{3,}/);
	});

	it('indents code block content with 4 spaces', () => {
		const inputMarkdown = '```js\nconst x = 1;\n```';
		const actualText = markdownToPlainText(inputMarkdown);
		expect(actualText).not.toContain('```');
		expect(actualText).toContain('    const x = 1;');
	});

	it('handles empty string', () => {
		expect(markdownToPlainText('')).toBe('');
	});

	it('preserves plain text without markdown unchanged', () => {
		const inputText = 'Just plain text with no formatting.';
		expect(markdownToPlainText(inputText)).toBe(inputText);
	});
});

describe('buildPdfMailtoUrl', () => {
	it('builds a mailto URL with subject pre-filled', () => {
		const actualUrl = buildPdfMailtoUrl('My Note');
		expect(actualUrl).toMatch(/^mailto:\?/);
		expect(actualUrl).toContain('subject=');
		expect(actualUrl).toContain(encodeURIComponent('My Note'));
	});

	it('includes a body referencing the PDF attachment', () => {
		const actualUrl = buildPdfMailtoUrl('My Note');
		const decoded = decodeURIComponent(actualUrl);
		expect(decoded).toContain('PDF');
	});
});
