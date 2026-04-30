import { extractDocumentText, getPandocFormat } from '../document-extract';

describe('getPandocFormat', () => {
	it('returns rtf for application/rtf', () => {
		expect(getPandocFormat('application/rtf', 'doc.rtf')).toBe('rtf');
	});

	it('returns rtf for text/rtf', () => {
		expect(getPandocFormat('text/rtf', 'doc.rtf')).toBe('rtf');
	});

	it('returns docx for Word OOXML mime type', () => {
		expect(
			getPandocFormat(
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				'doc.docx',
			),
		).toBe('docx');
	});

	it('returns odt for ODT mime type', () => {
		expect(getPandocFormat('application/vnd.oasis.opendocument.text', 'doc.odt')).toBe('odt');
	});

	it('falls back to extension when mime type is generic octet-stream', () => {
		expect(getPandocFormat('application/octet-stream', 'report.rtf')).toBe('rtf');
		expect(getPandocFormat('application/octet-stream', 'report.docx')).toBe('docx');
		expect(getPandocFormat('application/octet-stream', 'report.odt')).toBe('odt');
	});

	it('returns null for unknown format', () => {
		expect(getPandocFormat('application/octet-stream', 'archive.xyz')).toBeNull();
		expect(getPandocFormat('application/zip', 'file.zip')).toBeNull();
	});
});

describe('extractDocumentText', () => {
	it('extracts plain text from a minimal RTF document', async () => {
		const rtf = '{\\rtf1\\ansi Hello World from RTF}';
		const base64 = Buffer.from(rtf).toString('base64');
		const text = await extractDocumentText(base64, 'application/rtf', 'test.rtf');
		expect(text).toContain('Hello World from RTF');
	});

	it('returns the same text for a plain .rtf file detected by extension', async () => {
		const rtf = '{\\rtf1\\ansi Detected by extension}';
		const base64 = Buffer.from(rtf).toString('base64');
		const text = await extractDocumentText(base64, 'application/octet-stream', 'test.rtf');
		expect(text).toContain('Detected by extension');
	});

	it('throws for an unsupported document format', async () => {
		const base64 = Buffer.from('data').toString('base64');
		await expect(
			extractDocumentText(base64, 'application/octet-stream', 'archive.xyz'),
		).rejects.toThrow('Unsupported document format');
	});

	it('throws when pandoc receives a truncated DOCX (invalid ZIP)', async () => {
		// DOCX is a ZIP file; truncated bytes cause pandoc to fail ZIP parsing
		const base64 = Buffer.from('PK\x03\x04truncated').toString('base64');
		await expect(
			extractDocumentText(
				base64,
				'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				'bad.docx',
			),
		).rejects.toThrow();
	});
});
