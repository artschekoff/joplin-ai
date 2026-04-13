interface PdfTextItem {
	str: string;
}

interface PdfTextContent {
	items: PdfTextItem[];
}

interface PdfPage {
	getTextContent: () => Promise<PdfTextContent>;
}

interface PdfDocument {
	numPages: number;
	getPage: (pageNum: number) => Promise<PdfPage>;
}

interface PdfDocumentLoadingTask {
	promise: Promise<PdfDocument>;
}

interface PdfJsLib {
	getDocument: (params: { data: Uint8Array }) => PdfDocumentLoadingTask;
}

/**
 * Extract all human-readable text from a base64-encoded PDF using pdfjs-dist.
 *
 * Handles FlateDecode-compressed streams, CMap font encodings, and multi-page
 * documents — everything the lightweight webview parser cannot.
 *
 * @returns Concatenated page text separated by newlines, or empty string on
 *   failure / no extractable text.
 */
export const extractPdfTextFromBase64 = async (base64Data: string): Promise<string> => {
	const pdfjsLib: PdfJsLib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLib;
	const data = new Uint8Array(Buffer.from(base64Data, 'base64'));
	const doc = await pdfjsLib.getDocument({ data }).promise;
	const pages: string[] = [];
	for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
		const page = await doc.getPage(pageNum);
		const content = await page.getTextContent();
		const pageText = content.items.map((item) => item.str).join(' ');
		if (pageText.trim()) pages.push(pageText.trim());
	}
	return pages.join('\n');
};
