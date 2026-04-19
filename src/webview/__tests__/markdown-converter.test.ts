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

describe('markdownToBlocks — markdown table parsing', () => {
	it('should parse a simple markdown table into a table block', () => {
		const md = ['| Name | Age |', '| --- | --- |', '| Alice | 30 |', '| Bob | 25 |'].join('\n');
		const blocks = converter.markdownToBlocks(md);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('table');
		expect(blocks[0].data.withHeadings).toBe(true);
		const content = blocks[0].data.content as string[][];
		expect(content).toHaveLength(3);
		expect(content[0]).toEqual(['Name', 'Age']);
		expect(content[1]).toEqual(['Alice', '30']);
		expect(content[2]).toEqual(['Bob', '25']);
	});

	it('should parse table with inline formatting in cells', () => {
		const md = ['| Feature | Status |', '| --- | --- |', '| **Bold** | *done* |'].join('\n');
		const blocks = converter.markdownToBlocks(md);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('table');
		const content = blocks[0].data.content as string[][];
		expect(content[1][0]).toContain('<b>Bold</b>');
		expect(content[1][1]).toContain('<i>done</i>');
	});

	it('should parse table with varying column counts (ragged rows)', () => {
		const md = ['| A | B | C |', '| --- | --- | --- |', '| 1 | 2 |'].join('\n');
		const blocks = converter.markdownToBlocks(md);
		expect(blocks).toHaveLength(1);
		const content = blocks[0].data.content as string[][];
		expect(content[0]).toHaveLength(3);
		expect(content[1]).toHaveLength(3);
		expect(content[1][2]).toBe('');
	});

	it('should handle table surrounded by other content', () => {
		const md = [
			'# Title',
			'',
			'| Col1 | Col2 |',
			'| --- | --- |',
			'| A | B |',
			'',
			'Some paragraph after.',
		].join('\n');
		const blocks = converter.markdownToBlocks(md);
		expect(blocks).toHaveLength(3);
		expect(blocks[0].type).toBe('header');
		expect(blocks[1].type).toBe('table');
		expect(blocks[2].type).toBe('paragraph');
	});

	it('should parse table with alignment markers in separator', () => {
		const md = ['| Left | Center | Right |', '| :--- | :---: | ---: |', '| L | C | R |'].join('\n');
		const blocks = converter.markdownToBlocks(md);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('table');
		const content = blocks[0].data.content as string[][];
		expect(content).toHaveLength(2);
		expect(content[0]).toEqual(['Left', 'Center', 'Right']);
	});

	it('should handle single-column table', () => {
		const md = ['| Item |', '| --- |', '| One |', '| Two |'].join('\n');
		const blocks = converter.markdownToBlocks(md);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe('table');
		const content = blocks[0].data.content as string[][];
		expect(content).toEqual([['Item'], ['One'], ['Two']]);
	});

	it('should not treat horizontal rules as table separators', () => {
		const md = ['---', '', 'text'].join('\n');
		const blocks = converter.markdownToBlocks(md);
		expect(blocks[0].type).toBe('delimiter');
	});
});

describe('blocksToMarkdown — table serialization', () => {
	it('should convert a table block with headings to markdown', () => {
		const blocks = [
			{
				type: 'table',
				data: {
					withHeadings: true,
					content: [
						['Name', 'Age'],
						['Alice', '30'],
						['Bob', '25'],
					],
				},
			},
		];
		const md = converter.blocksToMarkdown(blocks);
		const lines = md.split('\n');
		expect(lines[0]).toBe('| Name | Age |');
		expect(lines[1]).toMatch(/^\| -+ \| -+ \|$/);
		expect(lines[2]).toBe('| Alice | 30 |');
		expect(lines[3]).toBe('| Bob | 25 |');
	});

	it('should convert a table block without headings to markdown', () => {
		const blocks = [
			{
				type: 'table',
				data: {
					withHeadings: false,
					content: [
						['A', 'B'],
						['C', 'D'],
					],
				},
			},
		];
		const md = converter.blocksToMarkdown(blocks);
		const lines = md.split('\n');
		expect(lines[0]).toBe('| A | B |');
		expect(lines[1]).toBe('| C | D |');
		expect(lines).not.toContain(expect.stringMatching(/^| -/));
	});

	it('should round-trip a markdown table', () => {
		const original = ['| Name | Age |', '| --- | --- |', '| Alice | 30 |'].join('\n');
		const blocks = converter.markdownToBlocks(original);
		const md = converter.blocksToMarkdown(blocks);
		const roundTripped = converter.markdownToBlocks(md);
		expect(roundTripped).toHaveLength(1);
		expect(roundTripped[0].type).toBe('table');
		expect(roundTripped[0].data.content).toEqual(blocks[0].data.content);
	});

	it('should handle HTML inline formatting in table cells on serialize', () => {
		const blocks = [
			{
				type: 'table',
				data: {
					withHeadings: true,
					content: [
						['<b>Bold</b>', 'Plain'],
						['<i>Italic</i>', 'Text'],
					],
				},
			},
		];
		const md = converter.blocksToMarkdown(blocks);
		expect(md).toContain('**Bold**');
		expect(md).toContain('*Italic*');
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
