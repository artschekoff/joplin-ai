/**
 * @jest-environment jsdom
 *
 * Tests for markdown-converter.js — backslash escape handling.
 *
 * Bug: mdInlineToHtml does not handle markdown backslash escapes (e.g. \_)
 * so text like \_\_\_\_\_\_\_\_\_\_ renders with literal backslashes instead
 * of showing as __________ (common in Russian contract templates for
 * fill-in-the-blank fields).
 */

import * as fs from 'fs';
import * as path from 'path';

const converterSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'markdown-converter.js'),
	'utf-8',
);

type ConverterModule = {
	markdownToBlocks: (md: string) => Array<{ type: string; data: Record<string, unknown> }>;
	blocksToMarkdown: (blocks: Array<{ type: string; data: Record<string, unknown> }>) => string;
};

const loadConverter = (): ConverterModule => {
	// eslint-disable-next-line no-eval
	eval(converterSource);
	return (window as unknown as { MarkdownConverter: ConverterModule }).MarkdownConverter;
};

let converter: ConverterModule;

beforeEach(() => {
	converter = loadConverter();
});

afterEach(() => {
	delete (window as any).MarkdownConverter;
});

describe('mdInlineToHtml — backslash escape handling', () => {
	it('should convert escaped underscores to literal underscores', () => {
		const inputBlocks = converter.markdownToBlocks('Наименование / ФИО: \\_\\_\\_\\_\\_');
		const paragraph = inputBlocks.find((b) => b.type === 'paragraph');
		expect(paragraph).toBeDefined();
		const text = paragraph!.data.text as string;
		expect(text).not.toContain('\\');
		expect(text).toContain('_____');
	});

	it('should convert a long run of escaped underscores to literal underscores', () => {
		const input = '\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_';
		const inputBlocks = converter.markdownToBlocks(input);
		const paragraph = inputBlocks.find((b) => b.type === 'paragraph');
		expect(paragraph).toBeDefined();
		const text = paragraph!.data.text as string;
		expect(text).not.toContain('\\');
		expect(text).toBe('__________');
	});

	it('should convert escaped asterisks to literal asterisks', () => {
		const inputBlocks = converter.markdownToBlocks('Price: 100\\*');
		const paragraph = inputBlocks.find((b) => b.type === 'paragraph');
		expect(paragraph).toBeDefined();
		const text = paragraph!.data.text as string;
		expect(text).not.toContain('\\');
		expect(text).toContain('100*');
	});

	it('should convert escaped backslash to a single literal backslash', () => {
		const inputBlocks = converter.markdownToBlocks('Path: C:\\\\Users');
		const paragraph = inputBlocks.find((b) => b.type === 'paragraph');
		expect(paragraph).toBeDefined();
		const text = paragraph!.data.text as string;
		expect(text).toContain('C:\\Users');
	});

	it('should not confuse escaped underscores with bold/italic syntax', () => {
		const input = 'В лице: \\_\\_\\_\\_\\_\\_\\_\\_\\_\\_';
		const inputBlocks = converter.markdownToBlocks(input);
		const paragraph = inputBlocks.find((b) => b.type === 'paragraph');
		expect(paragraph).toBeDefined();
		const text = paragraph!.data.text as string;
		expect(text).not.toContain('<b>');
		expect(text).not.toContain('<i>');
		expect(text).not.toContain('\\');
		expect(text).toContain('__________');
	});

	it('should still convert real bold and italic markers', () => {
		const input = 'This is **bold** and *italic* and __also bold__';
		const inputBlocks = converter.markdownToBlocks(input);
		const paragraph = inputBlocks.find((b) => b.type === 'paragraph');
		expect(paragraph).toBeDefined();
		const text = paragraph!.data.text as string;
		expect(text).toContain('<b>bold</b>');
		expect(text).toContain('<i>italic</i>');
		expect(text).toContain('<b>also bold</b>');
	});

	it('should handle escaped tildes', () => {
		const inputBlocks = converter.markdownToBlocks('Not \\~\\~deleted\\~\\~');
		const paragraph = inputBlocks.find((b) => b.type === 'paragraph');
		expect(paragraph).toBeDefined();
		const text = paragraph!.data.text as string;
		expect(text).not.toContain('<s>');
		expect(text).not.toContain('\\');
		expect(text).toContain('~~deleted~~');
	});

	it('should handle escaped backticks', () => {
		const inputBlocks = converter.markdownToBlocks('Use \\`code\\` literally');
		const paragraph = inputBlocks.find((b) => b.type === 'paragraph');
		expect(paragraph).toBeDefined();
		const text = paragraph!.data.text as string;
		expect(text).not.toContain('<code>');
		expect(text).not.toContain('\\');
		expect(text).toContain('`code`');
	});
});

describe('blocksToMarkdown — escaping characters that would be misinterpreted', () => {
	it('should escape consecutive underscores so they round-trip correctly', () => {
		const inputBlocks = [{ type: 'paragraph', data: { text: 'ФИО: __________' } }];
		const md = converter.blocksToMarkdown(inputBlocks);
		expect(md).not.toContain('<b>');
		const roundTripped = converter.markdownToBlocks(md);
		const paragraph = roundTripped.find((b) => b.type === 'paragraph');
		expect(paragraph).toBeDefined();
		const text = paragraph!.data.text as string;
		expect(text).toContain('__________');
		expect(text).not.toContain('<b>');
		expect(text).not.toContain('<i>');
	});
});
