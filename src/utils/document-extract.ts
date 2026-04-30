import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MIME_TO_PANDOC: Record<string, string> = {
	'application/rtf': 'rtf',
	'text/rtf': 'rtf',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/msword': 'docx',
	'application/vnd.oasis.opendocument.text': 'odt',
	'application/vnd.oasis.opendocument.presentation': 'odp',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const EXT_TO_PANDOC: Record<string, string> = {
	'.rtf': 'rtf',
	'.docx': 'docx',
	'.doc': 'docx',
	'.odt': 'odt',
	'.odp': 'odp',
	'.pptx': 'pptx',
	'.xlsx': 'xlsx',
};

export const getPandocFormat = (mimeType: string, fileName: string): string | null => {
	if (MIME_TO_PANDOC[mimeType]) return MIME_TO_PANDOC[mimeType];
	const ext = path.extname(fileName).toLowerCase();
	return EXT_TO_PANDOC[ext] ?? null;
};

export const isDocumentMimeType = (mimeType: string, fileName: string): boolean =>
	getPandocFormat(mimeType, fileName) !== null;

export const extractDocumentText = async (
	base64Data: string,
	mimeType: string,
	fileName: string,
): Promise<string> => {
	const format = getPandocFormat(mimeType, fileName);
	if (!format) throw new Error(`Unsupported document format: ${mimeType} / ${fileName}`);

	const ext = path.extname(fileName) || `.${format}`;
	const tempPath = path.join(
		os.tmpdir(),
		`joplin-ai-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
	);

	fs.writeFileSync(tempPath, Buffer.from(base64Data, 'base64'));

	try {
		return await runPandoc(tempPath, format);
	} finally {
		try {
			fs.unlinkSync(tempPath);
		} catch {
			/* ignore temp file cleanup errors */
		}
	}
};

const runPandoc = (inputPath: string, format: string): Promise<string> =>
	new Promise((resolve, reject) => {
		const proc = spawn('pandoc', ['--from', format, '--to', 'plain', '--wrap=none', inputPath]);
		let stdout = '';
		let stderr = '';
		proc.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		proc.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		proc.on('error', reject);
		proc.on('close', (code) => {
			if (code === 0) resolve(stdout);
			else reject(new Error(`pandoc exited with code ${code}: ${stderr.trim()}`));
		});
	});
