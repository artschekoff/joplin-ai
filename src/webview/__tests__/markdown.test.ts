/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

const markdownJsSource = fs.readFileSync(path.resolve(__dirname, '..', 'markdown.js'), 'utf-8');

const loadRenderMarkdown = (): ((text: string) => string) => {
	eval(markdownJsSource);
	return (window as any).renderMarkdown;
};

describe('renderMarkdown', () => {
	let renderMarkdown: (text: string) => string;

	beforeEach(() => {
		renderMarkdown = loadRenderMarkdown();
	});

	afterEach(() => {
		delete (window as any).renderMarkdown;
	});

	it('is exposed as a global function on window', () => {
		expect(typeof renderMarkdown).toBe('function');
	});

	describe('inline formatting', () => {
		it('renders bold text with **', () => {
			const result = renderMarkdown('This is **bold** text');
			expect(result).toContain('<strong>bold</strong>');
		});

		it('renders italic text with *', () => {
			const result = renderMarkdown('This is *italic* text');
			expect(result).toContain('<em>italic</em>');
		});

		it('renders bold italic text with ***', () => {
			const result = renderMarkdown('This is ***bold italic*** text');
			expect(result).toContain('<strong><em>bold italic</em></strong>');
		});

		it('renders inline code with backticks', () => {
			const result = renderMarkdown('Use `console.log()` for debugging');
			expect(result).toContain('<code>console.log()</code>');
		});

		it('renders strikethrough with ~~', () => {
			const result = renderMarkdown('This is ~~deleted~~ text');
			expect(result).toContain('<del>deleted</del>');
		});
	});

	describe('code blocks', () => {
		it('renders fenced code blocks with triple backticks', () => {
			const input = '```\nconst x = 1;\nconst y = 2;\n```';
			const result = renderMarkdown(input);
			expect(result).toContain('<pre>');
			expect(result).toContain('<code>');
			expect(result).toContain('const x = 1;');
		});

		it('renders fenced code blocks with language identifier', () => {
			const input = '```javascript\nconst x = 1;\n```';
			const result = renderMarkdown(input);
			expect(result).toContain('<pre>');
			expect(result).toContain('<code');
			expect(result).toContain('const x = 1;');
		});

		it('does not apply inline formatting inside code blocks', () => {
			const input = '```\nThis is **not bold** inside code\n```';
			const result = renderMarkdown(input);
			expect(result).not.toContain('<strong>');
			expect(result).toContain('**not bold**');
		});

		it('preserves indentation inside code blocks', () => {
			const input = '```\nfunction test() {\n  return true;\n}\n```';
			const result = renderMarkdown(input);
			expect(result).toContain('  return true;');
		});
	});

	describe('headers', () => {
		it('renders h1 with #', () => {
			const result = renderMarkdown('# Title');
			expect(result).toContain('<h1>');
			expect(result).toContain('Title');
		});

		it('renders h2 with ##', () => {
			const result = renderMarkdown('## Section');
			expect(result).toContain('<h2>');
			expect(result).toContain('Section');
		});

		it('renders h3 with ###', () => {
			const result = renderMarkdown('### Subsection');
			expect(result).toContain('<h3>');
			expect(result).toContain('Subsection');
		});
	});

	describe('lists', () => {
		it('renders unordered list with -', () => {
			const input = '- Item 1\n- Item 2\n- Item 3';
			const result = renderMarkdown(input);
			expect(result).toContain('<ul>');
			expect(result).toContain('<li>');
			expect(result).toContain('Item 1');
			expect(result).toContain('Item 2');
		});

		it('renders unordered list with *', () => {
			const input = '* Item A\n* Item B';
			const result = renderMarkdown(input);
			expect(result).toContain('<ul>');
			expect(result).toContain('<li>');
		});

		it('renders ordered list with numbers', () => {
			const input = '1. First\n2. Second\n3. Third';
			const result = renderMarkdown(input);
			expect(result).toContain('<ol>');
			expect(result).toContain('<li>');
			expect(result).toContain('First');
		});
	});

	describe('links', () => {
		it('renders markdown links', () => {
			const result = renderMarkdown('Visit [Google](https://google.com)');
			expect(result).toContain('<a');
			expect(result).toContain('href="https://google.com"');
			expect(result).toContain('Google');
		});

		it('adds target="_blank" and rel="noopener" to links', () => {
			const result = renderMarkdown('[Link](https://example.com)');
			expect(result).toContain('target="_blank"');
			expect(result).toContain('rel="noopener noreferrer"');
		});
	});

	describe('blockquotes', () => {
		it('renders blockquotes with >', () => {
			const result = renderMarkdown('> This is a quote');
			expect(result).toContain('<blockquote>');
			expect(result).toContain('This is a quote');
		});
	});

	describe('horizontal rules', () => {
		it('renders horizontal rule with ---', () => {
			const result = renderMarkdown('---');
			expect(result).toContain('<hr');
		});
	});

	describe('paragraphs', () => {
		it('wraps plain text in paragraph tags', () => {
			const result = renderMarkdown('Hello world');
			expect(result).toContain('<p>');
			expect(result).toContain('Hello world');
		});

		it('separates paragraphs on double newlines', () => {
			const result = renderMarkdown('First paragraph\n\nSecond paragraph');
			const pCount = (result.match(/<p>/g) || []).length;
			expect(pCount).toBe(2);
		});
	});

	describe('security', () => {
		it('escapes HTML tags in regular text', () => {
			const result = renderMarkdown('Hello <script>alert("xss")</script>');
			expect(result).not.toContain('<script>');
			expect(result).toContain('&lt;script&gt;');
		});

		it('escapes HTML inside inline code', () => {
			const result = renderMarkdown('Use `<div>` for containers');
			expect(result).toContain('&lt;div&gt;');
		});

		it('escapes HTML inside code blocks', () => {
			const input = '```\n<script>alert("xss")</script>\n```';
			const result = renderMarkdown(input);
			expect(result).not.toContain('<script>');
			expect(result).toContain('&lt;script&gt;');
		});

		it('does not render javascript: protocol in links', () => {
			const result = renderMarkdown('[click](javascript:alert(1))');
			expect(result).not.toContain('javascript:');
		});
	});

	describe('edge cases', () => {
		it('handles empty string', () => {
			const result = renderMarkdown('');
			expect(result).toBe('');
		});

		it('handles whitespace-only input', () => {
			const result = renderMarkdown('   \n  \n  ');
			expect(result.trim()).toBe('');
		});

		it('handles mixed content (code block + text + list)', () => {
			const input = 'Here is some code:\n\n```\nconst x = 1;\n```\n\nAnd a list:\n\n- one\n- two';
			const result = renderMarkdown(input);
			expect(result).toContain('<pre>');
			expect(result).toContain('<ul>');
			expect(result).toContain('const x = 1;');
		});
	});
});
