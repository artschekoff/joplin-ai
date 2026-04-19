/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

const cssSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'panel.css'),
	'utf-8',
);

describe('block editor selection CSS', () => {
	describe('::selection rules use background-color (not background shorthand)', () => {
		it('should use background-color in #editor-container ::selection', () => {
			const selectionBlocks = extractSelectionBlocks(cssSource);
			const editorSelectionBlocks = selectionBlocks.filter(
				(b) =>
					b.selector.includes('#editor-container') &&
					b.selector.includes('::selection') &&
					!b.selector.includes('::-moz-selection'),
			);
			expect(editorSelectionBlocks.length).toBeGreaterThanOrEqual(1);
			for (const block of editorSelectionBlocks) {
				expect(block.body).toMatch(/background-color\s*:/);
				expect(block.body).not.toMatch(/(?<![a-z-])background\s*:/);
			}
		});

		it('should use background-color in #editor-container ::-moz-selection', () => {
			const selectionBlocks = extractSelectionBlocks(cssSource);
			const mozBlocks = selectionBlocks.filter(
				(b) =>
					b.selector.includes('#editor-container') &&
					b.selector.includes('::-moz-selection'),
			);
			expect(mozBlocks.length).toBeGreaterThanOrEqual(1);
			for (const block of mozBlocks) {
				expect(block.body).toMatch(/background-color\s*:/);
				expect(block.body).not.toMatch(/(?<![a-z-])background\s*:/);
			}
		});
	});

	describe('::selection rules use !important to override Editor.js injected styles', () => {
		it('should have !important on background-color in selection rules', () => {
			const selectionBlocks = extractSelectionBlocks(cssSource);
			const editorBlocks = selectionBlocks.filter(
				(b) => b.selector.includes('#editor-container'),
			);
			expect(editorBlocks.length).toBeGreaterThanOrEqual(1);
			for (const block of editorBlocks) {
				expect(block.body).toMatch(/background-color\s*:.*!important/);
			}
		});
	});

	describe('::selection targets Editor.js contenteditable elements', () => {
		it('should target contenteditable elements for selection styling', () => {
			const selectionBlocks = extractSelectionBlocks(cssSource);
			const editorBlocks = selectionBlocks.filter(
				(b) =>
					b.selector.includes('#editor-container') &&
					b.selector.includes('::selection'),
			);
			const allSelectors = editorBlocks.map((b) => b.selector).join('\n');
			expect(allSelectors).toMatch(/\[contenteditable\]/);
		});
	});

	describe('CSS variables define orange selection color', () => {
		it('should define --selection-bg as orange in light mode', () => {
			expect(cssSource).toMatch(/--selection-bg\s*:\s*rgba\(245/);
		});

		it('should define --selection-bg as orange in dark mode', () => {
			expect(cssSource).toMatch(/--selection-bg\s*:\s*rgba\(251/);
		});
	});

	describe('block-level selection overrides Editor.js default blue', () => {
		it('should override .ce-block--selected .ce-block__content background with orange', () => {
			const blocks = extractCssBlocks(cssSource);
			const selectedBlocks = blocks.filter(
				(b) =>
					b.selector.includes('ce-block--selected') &&
					b.selector.includes('ce-block__content'),
			);
			expect(selectedBlocks.length).toBeGreaterThanOrEqual(1);
			for (const block of selectedBlocks) {
				expect(block.body).toMatch(/background(-color)?\s*:.*var\(--selection-bg\).*!important/);
			}
		});

		it('should override .codex-editor-overlay__rectangle background with orange', () => {
			const blocks = extractCssBlocks(cssSource);
			const rectBlocks = blocks.filter((b) =>
				b.selector.includes('codex-editor-overlay__rectangle'),
			);
			expect(rectBlocks.length).toBeGreaterThanOrEqual(1);
			for (const block of rectBlocks) {
				expect(block.body).toMatch(/background(-color)?\s*:.*var\(--selection-bg\).*!important/);
			}
		});

		it('should override border color on .codex-editor-overlay__rectangle', () => {
			const blocks = extractCssBlocks(cssSource);
			const rectBlocks = blocks.filter((b) =>
				b.selector.includes('codex-editor-overlay__rectangle'),
			);
			expect(rectBlocks.length).toBeGreaterThanOrEqual(1);
			for (const block of rectBlocks) {
				expect(block.body).toMatch(/border(-color)?\s*:.*!important/);
			}
		});
	});
});

interface CssBlock {
	selector: string;
	body: string;
}

/**
 * Extracts CSS rule blocks whose selectors contain `::selection`,
 * `::-moz-selection`, or other selection-related keywords.
 * Simple brace-matching parser — good enough for top-level rules.
 */
const extractSelectionBlocks = (css: string): CssBlock[] => {
	const blocks: CssBlock[] = [];
	const re = /([^{}]+)\{([^}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(css)) !== null) {
		const selector = match[1].trim();
		const body = match[2].trim();
		if (selector.includes('selection')) {
			blocks.push({ selector, body });
		}
	}
	return blocks;
};

/** Extracts ALL CSS rule blocks (selector + body). */
const extractCssBlocks = (css: string): CssBlock[] => {
	const blocks: CssBlock[] = [];
	const re = /([^{}]+)\{([^}]*)\}/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(css)) !== null) {
		blocks.push({ selector: match[1].trim(), body: match[2].trim() });
	}
	return blocks;
};
