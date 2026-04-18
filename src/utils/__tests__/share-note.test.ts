import * as os from 'os';
import * as path from 'path';

const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args),
}));

const mockWriteFile = jest.fn().mockResolvedValue(undefined);
const mockCopyFile = jest.fn().mockResolvedValue(undefined);
jest.mock('fs', () => ({
	promises: {
		writeFile: (...args: unknown[]) => mockWriteFile(...args),
		copyFile: (...args: unknown[]) => mockCopyFile(...args),
	},
}));

import {
	buildTextMailtoUrl,
	buildPdfMailtoUrl,
	markdownToPlainText,
	exportNoteWithPandoc,
	copyFileToDirectory,
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

describe('exportNoteWithPandoc', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockExecFile.mockImplementation(
			(_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
				cb(null);
			},
		);
	});

	it('writes markdown to a temp file and calls pandoc with --standalone for docx format', async () => {
		await exportNoteWithPandoc({ title: 'My Note', body: '# Hello', format: 'docx' });
		expect(mockWriteFile).toHaveBeenCalledWith(
			expect.stringContaining('My Note.md'),
			'# Hello',
			'utf-8',
		);
		const pandocArgs = mockExecFile.mock.calls[0][1] as string[];
		expect(pandocArgs).toContain('--standalone');
		expect(pandocArgs).toContain('-o');
		expect(pandocArgs).toEqual(
			expect.arrayContaining([
				expect.stringContaining('My Note.md'),
				expect.stringContaining('My Note.docx'),
			]),
		);
	});

	it('writes markdown to a temp file and calls pandoc with --standalone for rtf format', async () => {
		await exportNoteWithPandoc({ title: 'Report', body: 'Some text', format: 'rtf' });
		expect(mockWriteFile).toHaveBeenCalledWith(
			expect.stringContaining('Report.md'),
			'Some text',
			'utf-8',
		);
		const pandocArgs = mockExecFile.mock.calls[0][1] as string[];
		expect(pandocArgs).toContain('--standalone');
		expect(pandocArgs).toContain('-o');
		expect(pandocArgs).toEqual(
			expect.arrayContaining([
				expect.stringContaining('Report.md'),
				expect.stringContaining('Report.rtf'),
			]),
		);
	});

	it('returns the output file path', async () => {
		const actualPath = await exportNoteWithPandoc({
			title: 'Test',
			body: 'content',
			format: 'docx',
		});
		expect(actualPath).toBe(path.join(os.tmpdir(), 'Test.docx'));
	});

	it('sanitizes special characters from title for the filename', async () => {
		const actualPath = await exportNoteWithPandoc({
			title: 'My/Note: "special" <chars>',
			body: 'body',
			format: 'docx',
		});
		expect(actualPath).not.toContain('/Note');
		expect(actualPath).not.toContain('"');
		expect(actualPath).not.toContain('<');
		expect(actualPath).toContain('.docx');
	});

	it('uses fallback filename when title is empty', async () => {
		const actualPath = await exportNoteWithPandoc({
			title: '',
			body: 'body',
			format: 'rtf',
		});
		expect(actualPath).toContain('note.rtf');
	});

	it('uses fallback filename when title contains only special characters', async () => {
		const actualPath = await exportNoteWithPandoc({
			title: '///???',
			body: 'body',
			format: 'docx',
		});
		expect(actualPath).toContain('note.docx');
	});

	it('rejects when pandoc exits with an error', async () => {
		mockExecFile.mockImplementation(
			(_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
				cb(new Error('pandoc: command not found'));
			},
		);
		await expect(
			exportNoteWithPandoc({ title: 'Test', body: 'content', format: 'docx' }),
		).rejects.toThrow('pandoc');
	});

	it('rejects when writing the temp file fails', async () => {
		mockWriteFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));
		await expect(
			exportNoteWithPandoc({ title: 'Test', body: 'content', format: 'rtf' }),
		).rejects.toThrow('EACCES');
	});

	it('places temp files in the OS temp directory', async () => {
		await exportNoteWithPandoc({ title: 'Temp Test', body: 'data', format: 'docx' });
		const writePath = mockWriteFile.mock.calls[0][0] as string;
		expect(writePath).toContain(os.tmpdir());
	});
});

describe('copyFileToDirectory', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('copies the source file to the target directory preserving the filename', async () => {
		const actualDest = await copyFileToDirectory('/tmp/My Note.docx', '/Users/me/Documents');
		expect(mockCopyFile).toHaveBeenCalledWith(
			'/tmp/My Note.docx',
			path.join('/Users/me/Documents', 'My Note.docx'),
		);
		expect(actualDest).toBe(path.join('/Users/me/Documents', 'My Note.docx'));
	});

	it('preserves the original extension when copying', async () => {
		const actualDest = await copyFileToDirectory('/tmp/Report.rtf', '/Users/me/Desktop');
		expect(actualDest).toBe(path.join('/Users/me/Desktop', 'Report.rtf'));
	});

	it('rejects when fs.copyFile fails', async () => {
		mockCopyFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));
		await expect(
			copyFileToDirectory('/tmp/Note.docx', '/Users/me/Documents'),
		).rejects.toThrow('EACCES');
	});
});
