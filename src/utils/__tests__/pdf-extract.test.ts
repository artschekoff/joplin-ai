import { extractPdfTextFromBase64 } from '../pdf-extract';

/**
 * Minimal valid PDF with FlateDecode-compressed text stream containing
 * "Hello from compressed PDF". Generated with Python zlib.compress().
 */
const COMPRESSED_PDF_BASE64 =
	'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9Db250ZW50cyA0IDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0vUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNjMvRmlsdGVyL0ZsYXRlRGVjb2RlPj5zdHJlYW0NCniccwpR0HczVDA0UghJUzA0MFAwB+KQFAUNj9ScnHyFtKL8XIXk/NyCotTi4tQUhQAXN02FkCwF1xAArI8QGQ0KZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj5lbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTIgMDAwMDAgbiAKMDAwMDAwMDEwMSAwMDAwMCBuIAowMDAwMDAwMjExIDAwMDAwIG4gCjAwMDAwMDAzNDEgMDAwMDAgbiAKdHJhaWxlcjw8L1NpemUgNi9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjQwMgolJUVPRgo=';

describe('extractPdfTextFromBase64', () => {
	it('extracts text from a FlateDecode-compressed PDF', async () => {
		const text = await extractPdfTextFromBase64(COMPRESSED_PDF_BASE64);
		expect(text).toContain('Hello from compressed PDF');
	});

	it('returns empty string for an empty PDF (no text content)', async () => {
		const emptyPdfBase64 = Buffer.from(
			'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
				'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
				'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
				'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n' +
				'0000000052 00000 n \n0000000101 00000 n \n' +
				'trailer<</Size 4/Root 1 0 R>>\nstartxref\n172\n%%EOF\n',
		).toString('base64');
		const text = await extractPdfTextFromBase64(emptyPdfBase64);
		expect(text).toBe('');
	});

	it('rejects on invalid base64 / corrupt PDF data', async () => {
		await expect(extractPdfTextFromBase64('not-valid-pdf-data')).rejects.toThrow();
	});
});
