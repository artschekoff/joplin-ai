/**
 * markdown-converter.js
 *
 * Bidirectional conversion between Joplin's Markdown and Editor.js block format.
 * Exposed as window.MarkdownConverter = { markdownToBlocks, blocksToMarkdown }.
 *
 * Inline formatting (bold, italic, code, links, strikethrough) is converted
 * between Markdown syntax and the HTML tags that Editor.js uses internally,
 * so notes round-trip cleanly when switching between editors.
 */

/* global window */

// ── Inline: Markdown → HTML ───────────────────────────────────────────────

const mdInlineToHtml = (md) => {
	if (!md) return '';
	return md
		.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[\da-f]+);)/gi, '&amp;')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
		.replace(/__(.+?)__/gs, '<b>$1</b>')
		.replace(/\*(.+?)\*/gs, '<i>$1</i>')
		.replace(/_([^_]+)_/gs, '<i>$1</i>')
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
		.replace(/~~(.+?)~~/gs, '<s>$1</s>');
};

// ── Inline: HTML → Markdown ───────────────────────────────────────────────

const htmlInlineToMd = (html) => {
	if (!html) return '';
	return html
		.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
		.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
		.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
		.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
		.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
		.replace(/<s>([\s\S]*?)<\/s>/gi, '~~$1~~')
		.replace(/<del>([\s\S]*?)<\/del>/gi, '~~$1~~')
		.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"');
};

// ── Markdown → Editor.js blocks ───────────────────────────────────────────

/**
 * Convert a Markdown string to an array of Editor.js block objects.
 * Consecutive list items of the same style are merged into one list block.
 */
const markdownToBlocks = (markdown) => {
	if (!markdown) return [];

	const lines = markdown.split('\n');
	const blocks = [];

	let inCodeBlock = false;
	let codeLang = '';
	let codeLines = [];

	const flushCode = () => {
		if (codeLines.length > 0) {
			blocks.push({ type: 'code', data: { code: codeLines.join('\n') } });
		}
		codeLines = [];
		codeLang = '';
		inCodeBlock = false;
	};

	// Merge consecutive same-type list items into the last block
	const pushListItem = (style, itemHtml) => {
		const last = blocks[blocks.length - 1];
		if (last && last.type === 'list' && last.data.style === style) {
			last.data.items.push(itemHtml);
		} else {
			blocks.push({ type: 'list', data: { style, items: [itemHtml] } });
		}
	};

	const pushChecklistItem = (checked, itemHtml) => {
		const last = blocks[blocks.length - 1];
		if (last && last.type === 'checklist') {
			last.data.items.push({ text: itemHtml, checked });
		} else {
			blocks.push({ type: 'checklist', data: { items: [{ text: itemHtml, checked }] } });
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// ── fenced code block ───────────────────────────────────────────────
		if (/^```/.test(line)) {
			if (inCodeBlock) {
				flushCode();
			} else {
				inCodeBlock = true;
				codeLang = line.slice(3).trim();
			}
			continue;
		}
		if (inCodeBlock) {
			codeLines.push(line);
			continue;
		}

		// ── heading ─────────────────────────────────────────────────────────
		const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
		if (headingMatch) {
			blocks.push({
				type: 'header',
				data: {
					level: headingMatch[1].length,
					text: mdInlineToHtml(headingMatch[2].trim()),
				},
			});
			continue;
		}

		// ── horizontal rule ─────────────────────────────────────────────────
		if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
			blocks.push({ type: 'delimiter', data: {} });
			continue;
		}

		// ── blockquote ──────────────────────────────────────────────────────
		const quoteMatch = line.match(/^>\s*(.*)/);
		if (quoteMatch) {
			blocks.push({
				type: 'quote',
				data: { text: mdInlineToHtml(quoteMatch[1].trim()), caption: '' },
			});
			continue;
		}

		// ── checklist ───────────────────────────────────────────────────────
		const checkMatch = line.match(/^[-*+]\s+\[([ xX])\]\s+(.*)/);
		if (checkMatch) {
			const checked = checkMatch[1].toLowerCase() === 'x';
			pushChecklistItem(checked, mdInlineToHtml(checkMatch[2].trim()));
			continue;
		}

		// ── unordered list ──────────────────────────────────────────────────
		const ulMatch = line.match(/^[-*+]\s+(.*)/);
		if (ulMatch) {
			pushListItem('unordered', mdInlineToHtml(ulMatch[1].trim()));
			continue;
		}

		// ── ordered list ────────────────────────────────────────────────────
		const olMatch = line.match(/^\d+\.\s+(.*)/);
		if (olMatch) {
			pushListItem('ordered', mdInlineToHtml(olMatch[1].trim()));
			continue;
		}

		// ── blank line → skip (no empty paragraph blocks) ───────────────────
		if (line.trim() === '') {
			continue;
		}

		// ── paragraph ───────────────────────────────────────────────────────
		blocks.push({ type: 'paragraph', data: { text: mdInlineToHtml(line) } });
	}

	// Flush any unclosed code block
	if (inCodeBlock) flushCode();

	return blocks;
};

// ── Editor.js blocks → Markdown ───────────────────────────────────────────

/**
 * Read text from an Editor.js list item.
 * Handles both plain string (input format) and v2 object { content, items } (output format).
 */
const listItemText = (item) => {
	const raw = typeof item === 'string' ? item : (item.content ?? item.text ?? '');
	return htmlInlineToMd(raw);
};

/**
 * Convert an array of Editor.js block objects back to a Markdown string.
 */
const blocksToMarkdown = (blocks) => {
	if (!blocks || !blocks.length) return '';

	const parts = [];

	for (const block of blocks) {
		const d = block.data || {};

		switch (block.type) {
			case 'header': {
				const level = Math.min(Math.max(d.level || 1, 1), 6);
				parts.push('#'.repeat(level) + ' ' + htmlInlineToMd(d.text || ''));
				break;
			}

			case 'paragraph':
				parts.push(htmlInlineToMd(d.text || ''));
				break;

			case 'list': {
				const items = d.items || [];
				if (d.style === 'ordered') {
					items.forEach((item, idx) => {
						parts.push(`${idx + 1}. ${listItemText(item)}`);
					});
				} else {
					items.forEach((item) => {
						parts.push(`- ${listItemText(item)}`);
					});
				}
				break;
			}

			case 'checklist': {
				const items = d.items || [];
				items.forEach((item) => {
					const checked = item.checked ? 'x' : ' ';
					const text = htmlInlineToMd(item.text || item.content || '');
					parts.push(`- [${checked}] ${text}`);
				});
				break;
			}

			case 'code':
				parts.push('```\n' + (d.code || '') + '\n```');
				break;

			case 'quote':
				parts.push('> ' + htmlInlineToMd(d.text || ''));
				break;

			case 'delimiter':
				parts.push('---');
				break;

			default:
				// Unknown block type — try to extract any text content
				if (d.text) parts.push(htmlInlineToMd(d.text));
				break;
		}
	}

	return parts.join('\n\n');
};

// ── Expose globally ───────────────────────────────────────────────────────
window.MarkdownConverter = { markdownToBlocks, blocksToMarkdown };
