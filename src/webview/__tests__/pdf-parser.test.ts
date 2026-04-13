/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

const strToArrayBuffer = (str: string): ArrayBuffer => {
	const buffer = new ArrayBuffer(str.length);
	const view = new Uint8Array(buffer);
	for (let i = 0; i < str.length; i++) {
		view[i] = str.charCodeAt(i) & 0xff;
	}
	return buffer;
};

describe('extractPdfText', () => {
	let extractPdfText: (buffer: ArrayBuffer) => string;

	beforeEach(() => {
		const source = fs.readFileSync(path.resolve(__dirname, '..', 'pdf-parser.js'), 'utf-8');
		eval(source); // intentional: loads pdf-parser.js into jsdom window scope for testing
		extractPdfText = (window as unknown as { extractPdfText: (b: ArrayBuffer) => string })
			.extractPdfText;
	});

	afterEach(() => {
		delete (window as unknown as Record<string, unknown>).extractPdfText;
	});

	it('is exposed as a global function on window', () => {
		expect(typeof extractPdfText).toBe('function');
	});

	describe('non-PDF inputs', () => {
		it('returns empty string for empty ArrayBuffer', () => {
			const buffer = new ArrayBuffer(0);
			expect(extractPdfText(buffer)).toBe('');
		});

		it('returns empty string for non-PDF data', () => {
			const buffer = strToArrayBuffer('this is not a pdf file at all');
			expect(extractPdfText(buffer)).toBe('');
		});

		it('returns empty string for binary data without PDF header', () => {
			const buffer = strToArrayBuffer('\x00\x01\x02\x03');
			expect(extractPdfText(buffer)).toBe('');
		});
	});

	describe('basic text extraction', () => {
		it('extracts ASCII text from a BT/ET block with Tj operator', () => {
			const pdf = '%PDF-1.4\nBT\n(Hello World) Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			expect(extractPdfText(buffer)).toContain('Hello World');
		});

		it('extracts text from BT/ET block with TJ operator', () => {
			const pdf = '%PDF-1.4\nBT\n(Sample text) TJ\nET\n';
			const buffer = strToArrayBuffer(pdf);
			expect(extractPdfText(buffer)).toContain('Sample text');
		});

		it('extracts text from multiple BT/ET blocks', () => {
			const pdf = '%PDF-1.4\nBT\n(First line) Tj\nET\nBT\n(Second line) Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			const result = extractPdfText(buffer);
			expect(result).toContain('First line');
			expect(result).toContain('Second line');
		});

		it('returns empty string for PDF with no text blocks', () => {
			const pdf = '%PDF-1.4\n%EOF\n';
			const buffer = strToArrayBuffer(pdf);
			expect(extractPdfText(buffer)).toBe('');
		});
	});

	describe('hex-encoded text', () => {
		it('extracts hex-encoded text with Tj operator', () => {
			// "Hi" = 48 69 in ASCII hex
			const pdf = '%PDF-1.4\nBT\n<4869> Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			expect(extractPdfText(buffer)).toContain('Hi');
		});

		it('extracts hex-encoded full word', () => {
			// "PDF" = 50 44 46 in ASCII hex
			const pdf = '%PDF-1.4\nBT\n<504446> Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			expect(extractPdfText(buffer)).toContain('PDF');
		});
	});

	describe('escape sequences', () => {
		it('handles escaped parentheses in strings', () => {
			const pdf = '%PDF-1.4\nBT\n(Hello \\(World\\)) Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			const result = extractPdfText(buffer);
			expect(result).toContain('Hello');
			expect(result).toContain('World');
		});

		it('handles escaped backslash', () => {
			const pdf = '%PDF-1.4\nBT\n(Path\\\\File) Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			expect(extractPdfText(buffer)).toContain('Path');
		});

		it('handles \\n escape in PDF strings', () => {
			const pdf = '%PDF-1.4\nBT\n(Line one\\nLine two) Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			const result = extractPdfText(buffer);
			expect(result).toContain('Line one');
			expect(result).toContain('Line two');
		});
	});

	describe('error resilience', () => {
		it('does not throw on malformed PDF with unclosed string', () => {
			const pdf = '%PDF-1.4\nBT\n(unclosed string without ET';
			const buffer = strToArrayBuffer(pdf);
			expect(() => extractPdfText(buffer)).not.toThrow();
		});

		it('does not throw on PDF with empty BT/ET block', () => {
			const pdf = '%PDF-1.4\nBT\nET\n';
			const buffer = strToArrayBuffer(pdf);
			expect(() => extractPdfText(buffer)).not.toThrow();
			expect(extractPdfText(buffer)).toBe('');
		});

		it('does not throw on corrupted PDF content', () => {
			const pdf = '%PDF-1.4\n\x00\x01\x02BT\n(text) Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			expect(() => extractPdfText(buffer)).not.toThrow();
		});
	});

	describe('Cyrillic encoding', () => {
		it('decodes UTF-16BE hex Cyrillic "Привет" with FEFF BOM', () => {
			// П=041F р=0440 и=0438 в=0432 е=0435 т=0442
			const cyrHex = 'FEFF041F04400438043204350442';
			const pdf = `%PDF-1.4\nBT\n<${cyrHex}> Tj\nET\n`;
			const buffer = strToArrayBuffer(pdf);
			const result = extractPdfText(buffer);
			expect(result).toContain('\u041F'); // П
			expect(result).toContain('\u0440'); // р
			expect(result).toContain('\u0438'); // и
		});

		it('decodes UTF-16BE hex without BOM when all high bytes are 0x04 (Cyrillic block)', () => {
			// "АБ" = U+0410 U+0411 in UTF-16BE without BOM
			const cyrHex = '04100411';
			const pdf = `%PDF-1.4\nBT\n<${cyrHex}> Tj\nET\n`;
			const buffer = strToArrayBuffer(pdf);
			const result = extractPdfText(buffer);
			expect(result).toContain('\u0410'); // А
			expect(result).toContain('\u0411'); // Б
		});

		it('decodes UTF-16BE literal string with BOM bytes', () => {
			// Literal string with UTF-16BE BOM (\xFE\xFF) followed by "АБ" (U+0410 U+0411)
			// In Latin-1 byte encoding: \xFE\xFF\x04\x10\x04\x11
			const bom = '\xFE\xFF';
			const cyrLatin1 = '\x04\x10\x04\x11'; // А Б in UTF-16BE bytes
			const pdfStr = `%PDF-1.4\nBT\n(${bom}${cyrLatin1}) Tj\nET\n`;
			const buffer = strToArrayBuffer(pdfStr);
			const result = extractPdfText(buffer);
			expect(result).toContain('\u0410'); // А
			expect(result).toContain('\u0411'); // Б
		});

		it('decodes CP1251 Cyrillic literal strings', () => {
			// CP1251: А=0xC0, Б=0xC1, В=0xC2
			const cyrLatin1 = '\xC0\xC1\xC2';
			const pdf = `%PDF-1.4\nBT\n(${cyrLatin1}) Tj\nET\n`;
			const buffer = strToArrayBuffer(pdf);
			const result = extractPdfText(buffer);
			expect(result).toContain('\u0410'); // А
			expect(result).toContain('\u0411'); // Б
			expect(result).toContain('\u0412'); // В
		});

		it('does not misidentify ASCII-only text as CP1251', () => {
			const pdf = '%PDF-1.4\nBT\n(Hello World) Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			const result = extractPdfText(buffer);
			expect(result).toBe('Hello World');
		});
	});

	describe('output formatting', () => {
		it('trims leading and trailing whitespace from result', () => {
			const pdf = '%PDF-1.4\nBT\n(  Hello  ) Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			const result = extractPdfText(buffer);
			expect(result).toBe(result.trim());
		});

		it('collapses multiple spaces in output', () => {
			const pdf = '%PDF-1.4\nBT\n(Word1) Tj\nET\nBT\n(Word2) Tj\nET\n';
			const buffer = strToArrayBuffer(pdf);
			const result = extractPdfText(buffer);
			expect(result).not.toMatch(/\s{2,}/);
		});
	});
});
