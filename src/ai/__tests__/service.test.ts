import {
	buildSystemPrompt,
	buildSystemPromptParts,
	sendToAI,
	validateApiKey,
	buildOpenAIPdfParts,
	buildClaudePdfParts,
	buildOpenAIImageParts,
	buildClaudeImageParts,
} from '../service';
import { ChatMessage, NoteContextSnapshot } from '../types';

jest.mock('../openai', () => ({
	callOpenAI: jest.fn(),
	sendOpenAIMessages: jest.fn(),
	streamOpenAIMessages: jest.fn(),
}));
jest.mock('../claude', () => ({
	callClaude: jest.fn(),
	sendClaudeMessages: jest.fn(),
	streamClaudeMessages: jest.fn(),
}));
jest.mock('../perplexity', () => ({
	callPerplexity: jest.fn(),
	sendPerplexityRequest: jest.fn(),
	sendSonarChatRequest: jest.fn(),
	isSonarApiModel: jest.requireActual('../perplexity').isSonarApiModel,
	isPerplexityNativeModel: jest.requireActual('../perplexity').isPerplexityNativeModel,
	parseSonarToolCalls: jest.requireActual('../perplexity').parseSonarToolCalls,
	buildSonarToolCallPrompt: jest.requireActual('../perplexity').buildSonarToolCallPrompt,
}));
jest.mock('../../actions/registry', () => ({
	getActionHandlers: jest.fn(() => []),
	executeAction: jest.fn(),
	READ_ONLY_ACTIONS: new Set([
		'get_note',
		'open_note',
		'search_notes',
		'list_notebooks',
		'list_tags',
		'web_search',
	]),
}));
jest.mock('../tools', () => ({
	getOpenAITools: jest.fn(() => []),
	getClaudeTools: jest.fn(() => []),
	getPerplexityTools: jest.fn(() => []),
}));

import { streamOpenAIMessages } from '../openai';
import { streamClaudeMessages } from '../claude';
import { sendPerplexityRequest, sendSonarChatRequest } from '../perplexity';
import { executeAction } from '../../actions/registry';

const mockedStreamOpenAI = streamOpenAIMessages as jest.MockedFunction<typeof streamOpenAIMessages>;
const mockedStreamClaude = streamClaudeMessages as jest.MockedFunction<typeof streamClaudeMessages>;
const mockedSendPerplexity = sendPerplexityRequest as jest.MockedFunction<
	typeof sendPerplexityRequest
>;
const mockedSendSonarChat = sendSonarChatRequest as jest.MockedFunction<
	typeof sendSonarChatRequest
>;
const mockedExecuteAction = executeAction as jest.MockedFunction<typeof executeAction>;

describe('buildSystemPrompt', () => {
	it('includes note title and body', () => {
		const prompt = buildSystemPrompt({ noteTitle: 'My Note', noteBody: 'Hello world' });
		expect(prompt).toContain('Current note title: My Note');
		expect(prompt).toContain('Hello world');
	});

	it('lists all available tools', () => {
		const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
		expect(prompt).toContain('create_note');
		expect(prompt).toContain('get_note');
		expect(prompt).toContain('open_note');
		expect(prompt).toContain('update_note');
		expect(prompt).toContain('delete_note');
		expect(prompt).toContain('move_note');
		expect(prompt).toContain('search_notes');
		expect(prompt).toContain('list_notebooks');
		expect(prompt).toContain('create_notebook');
		expect(prompt).toContain('add_tag');
		expect(prompt).toContain('remove_tag');
		expect(prompt).toContain('list_tags');
		expect(prompt).toContain('web_search');
	});

	it('truncates body longer than 30000 characters', () => {
		const longBody = 'x'.repeat(35000);
		const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: longBody });
		expect(prompt).toContain('[... note truncated due to length ...]');
		expect(prompt).not.toContain('x'.repeat(35000));
	});

	it('does not truncate body at exactly 30000 characters', () => {
		const body = 'y'.repeat(30000);
		const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: body });
		expect(prompt).not.toContain('[... note truncated');
		expect(prompt).toContain(body);
	});

	describe('content sanitization', () => {
		it('strips U+FFFD replacement characters from note body', () => {
			const inputBody = 'об\uFFFD\uFFFDен данными, API, синхронизация';
			const actualPrompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: inputBody });
			expect(actualPrompt).not.toContain('\uFFFD');
			expect(actualPrompt).toContain('обен данными, API, синхронизация');
		});

		it('normalizes Windows CRLF line endings in note body', () => {
			const inputBody = 'Первая строка\r\nВторая строка';
			const actualPrompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: inputBody });
			expect(actualPrompt).not.toContain('\r\n');
			expect(actualPrompt).not.toContain('\r');
		});

		it('strips U+FFFD from referenced note body', () => {
			const inputReferencedNotes = [
				{ id: 'note1', title: 'Ref Note', body: 'об\uFFFD\uFFFDен данными' },
			];
			const actualPrompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'body',
				referencedNotes: inputReferencedNotes,
			});
			expect(actualPrompt).not.toContain('\uFFFD');
			expect(actualPrompt).toContain('обен данными');
		});

		it('strips U+FFFD from attached file content', () => {
			const inputFiles = [
				{
					name: 'test.txt',
					content: 'контракт об\uFFFD\uFFFDен данными',
					mimeType: 'text/plain',
					size: 100,
				},
			];
			const actualPrompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'body',
				attachedFiles: inputFiles,
			});
			expect(actualPrompt).not.toContain('\uFFFD');
			expect(actualPrompt).toContain('контракт обен данными');
		});
	});

	it('instructs AI to use tools proactively without asking confirmation for non-destructive actions', () => {
		const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
		expect(prompt).toMatch(/non-destructive|immediately|without.*confirm|act.*direct/i);
	});

	it('instructs AI to only ask confirmation for destructive operations', () => {
		const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
		expect(prompt).toMatch(/confirm.*delet|delet.*confirm/i);
	});

	it('instructs AI to act on user confirmations like yes or go ahead', () => {
		const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
		expect(prompt).toMatch(/yes|confirm.*proceed|go ahead/i);
	});

	describe('with agent role prompt', () => {
		it('prepends agent role prompt when provided', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				agentRolePrompt: 'You are a coding assistant',
			});
			expect(prompt).toContain('You are a coding assistant');
			const roleIndex = prompt.indexOf('You are a coding assistant');
			const defaultIndex = prompt.indexOf(
				'You are an AI assistant integrated into the Joplin note editor',
			);
			expect(roleIndex).toBeLessThan(defaultIndex);
		});

		it('does not include agent role section when agentRolePrompt is undefined', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
			expect(prompt).not.toContain('Agent Role');
		});

		it('does not include agent role section when agentRolePrompt is empty string', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				agentRolePrompt: '',
			});
			expect(prompt).not.toContain('Agent Role');
		});

		it('works with both notebooks and agent role prompt', () => {
			const notebooks = [{ id: 'f1', title: 'Work' }];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				notebooks,
				agentRolePrompt: 'You are a writing coach',
			});
			expect(prompt).toContain('You are a writing coach');
			expect(prompt).toContain('Work');
			expect(prompt).toContain('f1');
		});
	});

	describe('with work mode', () => {
		it('includes ask-mode section when workMode is "ask"', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body', workMode: 'ask' });
			expect(prompt).toContain('[Work Mode: Ask]');
		});

		it('includes edit-mode section when workMode is "edit"', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body', workMode: 'edit' });
			expect(prompt).toContain('[Work Mode: Edit]');
		});

		it('does not include work mode section when workMode is "agent"', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body', workMode: 'agent' });
			expect(prompt).not.toContain('[Work Mode:');
		});

		it('does not include work mode section when workMode is undefined', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
			expect(prompt).not.toContain('[Work Mode:');
		});

		it('ask mode instructs to not modify notes', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body', workMode: 'ask' });
			expect(prompt).toMatch(/do not|must not|cannot|prohibited/i);
			expect(prompt).toMatch(/creat|updat|delet|modif/i);
		});

		it('edit mode instructs to edit the current note', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body', workMode: 'edit' });
			expect(prompt).toMatch(/current note/i);
			expect(prompt).toMatch(/update_note/i);
		});

		it('edit mode instructs not to modify other notes', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'My Note',
				noteBody: 'Some content',
				workMode: 'edit',
			});
			expect(prompt).toMatch(/never.*create.*delete.*modify|do not.*modify/i);
		});

		it('edit mode includes the current note title in the mode section', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Shopping List',
				noteBody: '- Milk\n- Eggs',
				workMode: 'edit',
			});
			const modeStart = prompt.indexOf('[Work Mode: Edit]');
			const modeEnd = prompt.indexOf('[End Work Mode]');
			const modeSection = prompt.substring(modeStart, modeEnd);
			expect(modeSection).toContain('Shopping List');
		});

		it('edit mode describes update_note, structural tools, and read-only tools', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				workMode: 'edit',
			});
			expect(prompt).toContain('update_note');
			expect(prompt).toContain('copy_note');
			expect(prompt).toContain('delete_note');
			expect(prompt).toContain('move_note');
			expect(prompt).toContain('create_note');
			expect(prompt).toContain('get_note');
			expect(prompt).toContain('search_notes');
			expect(prompt).toContain('list_notebooks');
			expect(prompt).toContain('list_tags');
			expect(prompt).not.toMatch(/^- create_notebook:/m);
			expect(prompt).not.toMatch(/^- generate_image:/m);
			expect(prompt).not.toMatch(/^- remove_resource:/m);
		});

		it('edit mode instructs not to change the note title unless explicitly requested', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'My Contract',
				noteBody: 'Some content',
				workMode: 'edit',
			});
			expect(prompt).toMatch(
				/do not.*title|never.*title|title.*only.*explicit|title.*unless.*explicit|not.*rename.*unless|only.*rename.*explicit/i,
			);
		});

		it('edit mode instructs to apply changes immediately without asking questions', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test Note',
				noteBody: 'Content here',
				workMode: 'edit',
			});
			expect(prompt).toMatch(/do not ask|without asking|immediately|no clarif/i);
		});

		it('edit mode instructs to apply only the exact change requested', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test Note',
				noteBody: 'Content here',
				workMode: 'edit',
			});
			expect(prompt).toMatch(/only.*request|exact.*change|only.*ask|nothing.*else|no.*additional/i);
		});

		it('works with all parameters together', () => {
			const notebooks = [{ id: 'f1', title: 'Work' }];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				notebooks,
				agentRolePrompt: 'You are a writing coach',
				workMode: 'ask',
			});
			expect(prompt).toContain('You are a writing coach');
			expect(prompt).toContain('Work');
			expect(prompt).toContain('[Work Mode: Ask]');
		});
	});

	describe('with referenced notes', () => {
		const mockReferencedNotes = [
			{ id: 'ref-1', title: 'Design Doc', body: 'This is the design document content.' },
			{ id: 'ref-2', title: 'Meeting Notes', body: 'Discussion about the new feature.' },
		];

		it('includes referenced notes section when referencedNotes are provided', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				referencedNotes: mockReferencedNotes,
			});
			expect(prompt).toContain('Referenced notes');
			expect(prompt).toContain('Design Doc');
			expect(prompt).toContain('This is the design document content.');
			expect(prompt).toContain('Meeting Notes');
			expect(prompt).toContain('Discussion about the new feature.');
		});

		it('does not include referenced notes section when referencedNotes is empty', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				referencedNotes: [],
			});
			expect(prompt).not.toContain('Referenced notes');
		});

		it('does not include referenced notes section when referencedNotes is undefined', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
			expect(prompt).not.toContain('Referenced notes');
		});

		it('includes note ID in referenced notes section', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				referencedNotes: mockReferencedNotes,
			});
			expect(prompt).toContain('ref-1');
			expect(prompt).toContain('ref-2');
		});

		it('truncates individual referenced note bodies that are too long', () => {
			const longNote = [{ id: 'long-1', title: 'Long Note', body: 'x'.repeat(15000) }];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				referencedNotes: longNote,
			});
			expect(prompt).toContain('Long Note');
			expect(prompt).toContain('[... content truncated ...]');
			expect(prompt).not.toContain('x'.repeat(15000));
		});

		it('works with all parameters together', () => {
			const notebooks = [{ id: 'f1', title: 'Work' }];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				notebooks,
				agentRolePrompt: 'You are a coach',
				workMode: 'ask',
				referencedNotes: mockReferencedNotes,
			});
			expect(prompt).toContain('You are a coach');
			expect(prompt).toContain('Work');
			expect(prompt).toContain('[Work Mode: Ask]');
			expect(prompt).toContain('Design Doc');
			expect(prompt).toContain('Meeting Notes');
		});
	});

	describe('with attached files', () => {
		const mockAttachedFiles = [
			{ name: 'data.csv', content: 'col1,col2\n1,2\n3,4', mimeType: 'text/csv', size: 19 },
			{
				name: 'config.json',
				content: '{"key":"value"}',
				mimeType: 'application/json',
				size: 15,
			},
		];

		it('includes attached files section when attachedFiles are provided', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				attachedFiles: mockAttachedFiles,
			});
			expect(prompt).toContain('Attached files');
			expect(prompt).toContain('data.csv');
			expect(prompt).toContain('col1,col2');
			expect(prompt).toContain('config.json');
			expect(prompt).toContain('{"key":"value"}');
		});

		it('does not include attached files section when attachedFiles is empty', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body', attachedFiles: [] });
			expect(prompt).not.toContain('Attached files');
		});

		it('does not include attached files section when attachedFiles is undefined', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
			expect(prompt).not.toContain('Attached files');
		});

		it('includes file name and mime type in attached files section', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				attachedFiles: [mockAttachedFiles[0]],
			});
			expect(prompt).toContain('data.csv');
			expect(prompt).toContain('text/csv');
		});

		it('truncates large attached file content', () => {
			const largeFile = [
				{
					name: 'big.txt',
					content: 'x'.repeat(50000),
					mimeType: 'text/plain',
					size: 50000,
				},
			];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				attachedFiles: largeFile,
			});
			expect(prompt).toContain('big.txt');
			expect(prompt).toContain('[... content truncated ...]');
			expect(prompt).not.toContain('x'.repeat(50000));
		});

		it('works with all parameters together', () => {
			const notebooks = [{ id: 'f1', title: 'Work' }];
			const referencedNotes = [{ id: 'ref-1', title: 'Design Doc', body: 'Design content' }];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				notebooks,
				agentRolePrompt: 'You are a coach',
				workMode: 'agent',
				referencedNotes,
				attachedFiles: mockAttachedFiles,
			});
			expect(prompt).toContain('You are a coach');
			expect(prompt).toContain('Work');
			expect(prompt).toContain('Design Doc');
			expect(prompt).toContain('Attached files');
			expect(prompt).toContain('data.csv');
		});

		it('includes extracted PDF text in attached files section', () => {
			const pdfFile = [
				{
					name: 'report.pdf',
					content: 'This is the extracted text from the PDF report.',
					mimeType: 'application/pdf',
					size: 4096,
				},
			];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				attachedFiles: pdfFile,
			});
			expect(prompt).toContain('report.pdf');
			expect(prompt).toContain('application/pdf');
			expect(prompt).toContain('This is the extracted text from the PDF report.');
			expect(prompt).toContain('Attached files');
		});

		it('includes PDF file name and byte size in attached files section', () => {
			const pdfFile = [
				{
					name: 'annual-review.pdf',
					content: 'Annual review text content.',
					mimeType: 'application/pdf',
					size: 102400,
				},
			];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				attachedFiles: pdfFile,
			});
			expect(prompt).toContain('annual-review.pdf');
			expect(prompt).toContain('102400');
		});

		it('handles mixed PDF and text file attachments together', () => {
			const mixedFiles = [
				{
					name: 'notes.txt',
					content: 'plain text content',
					mimeType: 'text/plain',
					size: 18,
				},
				{
					name: 'doc.pdf',
					content: 'extracted pdf text content',
					mimeType: 'application/pdf',
					size: 8192,
				},
			];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				attachedFiles: mixedFiles,
			});
			expect(prompt).toContain('notes.txt');
			expect(prompt).toContain('plain text content');
			expect(prompt).toContain('doc.pdf');
			expect(prompt).toContain('extracted pdf text content');
		});

		it('excludes base64 PDF files from attached files text section in system prompt', () => {
			const files = [
				{
					name: 'text-file.txt',
					content: 'text content',
					mimeType: 'text/plain',
					size: 12,
				},
				{
					name: 'binary.pdf',
					content: '[PDF document]',
					mimeType: 'application/pdf',
					size: 50000,
					base64Data: 'JVBERi0xLjQ=',
				},
			];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				attachedFiles: files,
			});
			expect(prompt).toContain('text-file.txt');
			expect(prompt).toContain('text content');
			expect(prompt).not.toContain('binary.pdf');
			expect(prompt).not.toContain('JVBERi0xLjQ=');
		});

		it('does not include attached files section when all files are base64 PDFs', () => {
			const files = [
				{
					name: 'binary.pdf',
					content: '[PDF document]',
					mimeType: 'application/pdf',
					size: 50000,
					base64Data: 'JVBERi0xLjQ=',
				},
			];
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				attachedFiles: files,
			});
			expect(prompt).not.toContain('Attached files');
		});
	});

	describe('buildOpenAIPdfParts', () => {
		it('returns empty array when no files have base64Data', () => {
			const files = [{ name: 'text.txt', content: 'hello', mimeType: 'text/plain', size: 5 }];
			expect(buildOpenAIPdfParts(files)).toEqual([]);
		});

		it('returns file content part for base64 PDF', () => {
			const files = [
				{
					name: 'report.pdf',
					content: '[PDF document]',
					mimeType: 'application/pdf',
					size: 1000,
					base64Data: 'JVBERi0xLjQ=',
				},
			];
			const parts = buildOpenAIPdfParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0]).toEqual({
				type: 'file',
				file: {
					filename: 'report.pdf',
					file_data: 'data:application/pdf;base64,JVBERi0xLjQ=',
				},
			});
		});

		it('only includes files with base64Data', () => {
			const files = [
				{ name: 'text.txt', content: 'hello', mimeType: 'text/plain', size: 5 },
				{
					name: 'doc.pdf',
					content: '[PDF]',
					mimeType: 'application/pdf',
					size: 2000,
					base64Data: 'AAAA',
				},
			];
			const parts = buildOpenAIPdfParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0].file.filename).toBe('doc.pdf');
		});

		it('does not include image files even when they have base64Data', () => {
			const files = [
				{
					name: 'photo.png',
					content: '[Image]',
					mimeType: 'image/png',
					size: 5000,
					base64Data: 'iVBORw==',
				},
				{
					name: 'doc.pdf',
					content: '[PDF]',
					mimeType: 'application/pdf',
					size: 2000,
					base64Data: 'JVBERi0=',
				},
			];
			const parts = buildOpenAIPdfParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0].file.filename).toBe('doc.pdf');
		});
	});

	describe('buildClaudePdfParts', () => {
		it('returns empty array when no files have base64Data', () => {
			const files = [{ name: 'text.txt', content: 'hello', mimeType: 'text/plain', size: 5 }];
			expect(buildClaudePdfParts(files)).toEqual([]);
		});

		it('returns document content block for base64 PDF', () => {
			const files = [
				{
					name: 'audit.pdf',
					content: '[PDF document]',
					mimeType: 'application/pdf',
					size: 3000,
					base64Data: 'JVBERi0xLjQ=',
				},
			];
			const parts = buildClaudePdfParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0]).toEqual({
				type: 'document',
				source: {
					type: 'base64',
					media_type: 'application/pdf',
					data: 'JVBERi0xLjQ=',
				},
				title: 'audit.pdf',
			});
		});

		it('only includes files with base64Data', () => {
			const files = [
				{ name: 'notes.md', content: '# Notes', mimeType: 'text/markdown', size: 7 },
				{
					name: 'scan.pdf',
					content: '[PDF]',
					mimeType: 'application/pdf',
					size: 4000,
					base64Data: 'BBBB',
				},
			];
			const parts = buildClaudePdfParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0].title).toBe('scan.pdf');
		});

		it('does not include image files even when they have base64Data', () => {
			const files = [
				{
					name: 'photo.png',
					content: '[Image]',
					mimeType: 'image/png',
					size: 5000,
					base64Data: 'iVBORw==',
				},
				{
					name: 'doc.pdf',
					content: '[PDF]',
					mimeType: 'application/pdf',
					size: 2000,
					base64Data: 'JVBERi0=',
				},
			];
			const parts = buildClaudePdfParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0].title).toBe('doc.pdf');
		});
	});

	describe('buildOpenAIImageParts', () => {
		it('returns empty array when no image files present', () => {
			const files = [
				{ name: 'doc.pdf', content: '[PDF]', mimeType: 'application/pdf', size: 1000 },
			];
			expect(buildOpenAIImageParts(files)).toEqual([]);
		});

		it('excludes images without base64Data', () => {
			const files = [
				{ name: 'img.png', content: 'text fallback', mimeType: 'image/png', size: 100 },
			];
			expect(buildOpenAIImageParts(files)).toEqual([]);
		});

		it('returns image_url part for PNG with base64Data', () => {
			const files = [
				{
					name: 'screenshot.png',
					content: '[Image]',
					mimeType: 'image/png',
					size: 4096,
					base64Data: 'iVBORw==',
				},
			];
			const parts = buildOpenAIImageParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0]).toEqual({
				type: 'image_url',
				image_url: { url: 'data:image/png;base64,iVBORw==' },
			});
		});

		it('returns image_url part for JPEG with base64Data', () => {
			const files = [
				{
					name: 'photo.jpg',
					content: '[Image]',
					mimeType: 'image/jpeg',
					size: 8000,
					base64Data: '/9j/4AA=',
				},
			];
			const parts = buildOpenAIImageParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0].image_url.url).toBe('data:image/jpeg;base64,/9j/4AA=');
		});

		it('does not include PDF files in image parts', () => {
			const files = [
				{
					name: 'doc.pdf',
					content: '[PDF]',
					mimeType: 'application/pdf',
					size: 1000,
					base64Data: 'JVBERi0=',
				},
			];
			expect(buildOpenAIImageParts(files)).toEqual([]);
		});

		it('handles multiple images', () => {
			const files = [
				{ name: 'a.png', content: '[Image]', mimeType: 'image/png', size: 100, base64Data: 'AAAA' },
				{
					name: 'b.webp',
					content: '[Image]',
					mimeType: 'image/webp',
					size: 200,
					base64Data: 'BBBB',
				},
			];
			const parts = buildOpenAIImageParts(files);
			expect(parts).toHaveLength(2);
			expect(parts[0].image_url.url).toBe('data:image/png;base64,AAAA');
			expect(parts[1].image_url.url).toBe('data:image/webp;base64,BBBB');
		});
	});

	describe('buildClaudeImageParts', () => {
		it('returns empty array when no image files present', () => {
			const files = [{ name: 'note.txt', content: 'text', mimeType: 'text/plain', size: 4 }];
			expect(buildClaudeImageParts(files)).toEqual([]);
		});

		it('excludes images without base64Data', () => {
			const files = [{ name: 'img.gif', content: 'fallback', mimeType: 'image/gif', size: 50 }];
			expect(buildClaudeImageParts(files)).toEqual([]);
		});

		it('returns image block for PNG with base64Data', () => {
			const files = [
				{
					name: 'diagram.png',
					content: '[Image]',
					mimeType: 'image/png',
					size: 2048,
					base64Data: 'iVBORw==',
				},
			];
			const parts = buildClaudeImageParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0]).toEqual({
				type: 'image',
				source: {
					type: 'base64',
					media_type: 'image/png',
					data: 'iVBORw==',
				},
			});
		});

		it('returns image block for JPEG with base64Data', () => {
			const files = [
				{
					name: 'photo.jpg',
					content: '[Image]',
					mimeType: 'image/jpeg',
					size: 6000,
					base64Data: '/9j/4AA=',
				},
			];
			const parts = buildClaudeImageParts(files);
			expect(parts).toHaveLength(1);
			expect(parts[0].source.media_type).toBe('image/jpeg');
			expect(parts[0].source.data).toBe('/9j/4AA=');
		});

		it('does not include PDF files in image parts', () => {
			const files = [
				{
					name: 'report.pdf',
					content: '[PDF]',
					mimeType: 'application/pdf',
					size: 5000,
					base64Data: 'JVBERi0=',
				},
			];
			expect(buildClaudeImageParts(files)).toEqual([]);
		});

		it('handles webp and gif images', () => {
			const files = [
				{
					name: 'anim.gif',
					content: '[Image]',
					mimeType: 'image/gif',
					size: 100,
					base64Data: 'R0lGOD',
				},
				{
					name: 'banner.webp',
					content: '[Image]',
					mimeType: 'image/webp',
					size: 200,
					base64Data: 'UklGRg==',
				},
			];
			const parts = buildClaudeImageParts(files);
			expect(parts).toHaveLength(2);
			expect(parts[0].source.media_type).toBe('image/gif');
			expect(parts[1].source.media_type).toBe('image/webp');
		});
	});

	describe('with nativeWebSearch option', () => {
		it('does not include web_search bullet when nativeWebSearch is true', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				nativeWebSearch: true,
			});
			expect(prompt).not.toMatch(/^- web_search:/m);
		});

		it('mentions native web search capability when nativeWebSearch is true', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				nativeWebSearch: true,
			});
			expect(prompt).toMatch(/native.*web search|built-in.*search|web search.*built.?in/i);
		});

		it('includes web_search bullet when nativeWebSearch is false', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				nativeWebSearch: false,
			});
			expect(prompt).toMatch(/^- web_search:/m);
		});

		it('includes web_search bullet when nativeWebSearch is undefined', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
			expect(prompt).toMatch(/^- web_search:/m);
		});

		it('works with all parameters together when nativeWebSearch is true', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				agentRolePrompt: 'You are a researcher',
				workMode: 'agent',
				nativeWebSearch: true,
			});
			expect(prompt).toContain('You are a researcher');
			expect(prompt).not.toMatch(/^- web_search:/m);
			expect(prompt).toMatch(/native.*web search|built-in.*search/i);
		});
	});

	describe('with notebooks', () => {
		const mockNotebooks = [
			{ id: 'folder-1', title: 'Work' },
			{ id: 'folder-2', title: 'Personal' },
			{ id: 'folder-3', title: 'Archive' },
		];

		it('includes notebook names and IDs when notebooks are provided', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				notebooks: mockNotebooks,
			});
			expect(prompt).toContain('Work');
			expect(prompt).toContain('folder-1');
			expect(prompt).toContain('Personal');
			expect(prompt).toContain('folder-2');
			expect(prompt).toContain('Archive');
			expect(prompt).toContain('folder-3');
		});

		it('includes instruction to auto-assign notebook based on content', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				notebooks: mockNotebooks,
			});
			expect(prompt).toMatch(/notebook|parentId|parent_id/i);
			expect(prompt).toMatch(/assign|match|choose|select/i);
		});

		it('does not include notebook section when notebooks is undefined', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body' });
			expect(prompt).not.toContain('Available notebooks');
		});

		it('does not include notebook section when notebooks is empty', () => {
			const prompt = buildSystemPrompt({ noteTitle: 'Test', noteBody: 'Body', notebooks: [] });
			expect(prompt).not.toContain('Available notebooks');
		});

		it('includes all notebooks in the prompt', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Body',
				notebooks: mockNotebooks,
			});
			for (const nb of mockNotebooks) {
				expect(prompt).toContain(nb.title);
				expect(prompt).toContain(nb.id);
			}
		});
	});

	describe('with isSelection and selectionText', () => {
		it('embeds selection markers around the selected fragment in the body', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: '# Title\n\nDate: 17 April\n\n## Footer',
				isSelection: true,
				selectionText: 'Date: 17 April',
			});
			expect(prompt).toContain('>>>SELECTED<<<');
			expect(prompt).toContain('<<<END_SELECTED>>>');
			expect(prompt).toContain('>>>SELECTED<<<\nDate: 17 April\n<<<END_SELECTED>>>');
			expect(prompt).toContain('# Title');
			expect(prompt).toContain('## Footer');
		});

		it('includes SELECTION RULES when markers are present', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: '# Title\n\nDate: 17 April\n\n## Footer',
				isSelection: true,
				selectionText: 'Date: 17 April',
			});
			expect(prompt).toContain('SELECTION RULES');
			expect(prompt).toMatch(/COMPLETE text between the markers/);
		});

		it('includes SELECTION RULES in edit mode too', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: '# Title\n\nSelected paragraph\n\n## End',
				isSelection: true,
				selectionText: 'Selected paragraph',
				workMode: 'edit',
			});
			expect(prompt).toContain('SELECTION RULES');
			expect(prompt).toContain('>>>SELECTED<<<\nSelected paragraph\n<<<END_SELECTED>>>');
		});

		it('does not add markers when selectionText is not in the body', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Some body text',
				isSelection: true,
				selectionText: 'nonexistent fragment',
			});
			expect(prompt).not.toContain('>>>SELECTED<<<');
			expect(prompt).not.toContain('SELECTION RULES');
		});

		it('does not add markers when isSelection is false', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Full note content',
				isSelection: false,
			});
			expect(prompt).toContain('Current note content');
			expect(prompt).not.toContain('>>>SELECTED<<<');
		});

		it('does not add markers when isSelection is undefined', () => {
			const prompt = buildSystemPrompt({
				noteTitle: 'Test',
				noteBody: 'Full note content',
			});
			expect(prompt).toContain('Current note content');
			expect(prompt).not.toContain('>>>SELECTED<<<');
		});
	});
});

describe('buildSystemPromptParts with noteContextInHistory', () => {
	const snapshot: NoteContextSnapshot = {
		noteId: 'note-1',
		noteTitle: 'My Note',
		noteBody: 'Original content\nLine two\n',
	};

	it('omits body when note unchanged (ask mode)', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'My Note',
			noteId: 'note-1',
			noteBody: 'Original content\nLine two\n',
			noteContextInHistory: snapshot,
			workMode: 'ask',
		});
		expect(parts.bodyIncluded).toBe(false);
		expect(parts.diffStats).toBeUndefined();
		expect(parts.noteBodyContext).not.toContain('Original content');
		expect(parts.noteBodyContext).toContain('conversation context');
	});

	it('sends diff when note changed (small diff, ask mode)', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'My Note',
			noteId: 'note-1',
			noteBody: 'Original content\nLine two updated\n',
			noteContextInHistory: snapshot,
			workMode: 'ask',
		});
		expect(parts.bodyIncluded).toBe(false);
		expect(parts.diffStats).toBeDefined();
		expect(parts.diffStats!.added).toBeGreaterThan(0);
		expect(parts.noteBodyContext).toContain('[NOTE CHANGED]');
	});

	it('includes full body in edit mode even when unchanged', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'My Note',
			noteId: 'note-1',
			noteBody: 'Original content\nLine two\n',
			noteContextInHistory: snapshot,
			workMode: 'edit',
		});
		expect(parts.bodyIncluded).toBe(true);
		expect(parts.noteBodyContext).toContain('Original content');
	});

	it('sends full body when noteId differs', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'Different Note',
			noteId: 'note-2',
			noteBody: 'Different content\n',
			noteContextInHistory: snapshot,
			workMode: 'ask',
		});
		expect(parts.bodyIncluded).toBe(true);
		expect(parts.noteBodyContext).toContain('Different content');
	});

	it('sends full body when no noteContextInHistory', () => {
		const parts = buildSystemPromptParts({
			noteTitle: 'My Note',
			noteId: 'note-1',
			noteBody: 'Original content\nLine two\n',
			workMode: 'ask',
		});
		expect(parts.bodyIncluded).toBe(true);
		expect(parts.noteBodyContext).toContain('Original content');
	});
});

describe('validateApiKey', () => {
	it('throws when API key is empty string', () => {
		expect(() => validateApiKey('openai', '')).toThrow('API key for openai is not configured');
	});

	it('throws when API key is whitespace only', () => {
		expect(() => validateApiKey('claude', '   ')).toThrow('API key for claude is not configured');
	});

	it('does not throw when API key is valid', () => {
		expect(() => validateApiKey('openai', 'sk-valid-key')).not.toThrow();
	});
});

describe('sendToAI', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe('API key validation', () => {
		it('throws when API key is empty string', async () => {
			await expect(sendToAI('openai', '', 'gpt-4o', 'hello', 'Title', 'Body')).rejects.toThrow(
				'API key for openai is not configured',
			);
			expect(mockedStreamOpenAI).not.toHaveBeenCalled();
		});

		it('throws when API key is whitespace only', async () => {
			await expect(
				sendToAI('claude', '   ', 'claude-sonnet-4-6', 'hello', 'Title', 'Body'),
			).rejects.toThrow('API key for claude is not configured');
			expect(mockedStreamClaude).not.toHaveBeenCalled();
		});
	});

	it('routes to OpenAI when provider is "openai"', async () => {
		mockedStreamOpenAI.mockResolvedValue({
			textContent: 'Plain answer from OpenAI',
			toolCalls: [],
			finishReason: 'stop',
			rawAssistantMessage: { content: 'Plain answer from OpenAI' },
		});

		const result = await sendToAI('openai', 'sk-test', 'gpt-4o', 'What is this?', 'Title', 'Body');

		expect(mockedStreamOpenAI).toHaveBeenCalledTimes(1);
		expect(mockedStreamClaude).not.toHaveBeenCalled();
		expect(result.isEdit).toBe(false);
		expect(result.content).toBe('Plain answer from OpenAI');
		expect(result.actions).toEqual([]);
	});

	it('routes to Claude when provider is "claude"', async () => {
		mockedStreamClaude.mockResolvedValue({
			textContent: 'Answer from Claude',
			toolCalls: [],
			finishReason: 'end_turn',
			rawAssistantMessage: { role: 'assistant', content: [] },
		});

		const result = await sendToAI(
			'claude',
			'sk-ant-test',
			'claude-sonnet-4-6',
			'Explain',
			'Title',
			'Body',
		);

		expect(mockedStreamClaude).toHaveBeenCalledTimes(1);
		expect(mockedStreamOpenAI).not.toHaveBeenCalled();
		expect(result.isEdit).toBe(false);
		expect(result.content).toBe('Answer from Claude');
		expect(result.actions).toEqual([]);
	});

	it('routes claude-opus-4 model to Claude provider', async () => {
		mockedStreamClaude.mockResolvedValue({
			textContent: 'Answer from Claude Opus 4',
			toolCalls: [],
			finishReason: 'end_turn',
			rawAssistantMessage: { role: 'assistant', content: [] },
		});

		const result = await sendToAI(
			'claude',
			'sk-ant-test',
			'claude-opus-4-7',
			'Explain',
			'Title',
			'Body',
		);

		expect(mockedStreamClaude).toHaveBeenCalledTimes(1);
		expect(mockedStreamOpenAI).not.toHaveBeenCalled();
		expect(result.content).toBe('Answer from Claude Opus 4');
	});

	it('routes codex-mini-latest model to OpenAI provider', async () => {
		mockedStreamOpenAI.mockResolvedValue({
			textContent: 'Answer from Codex',
			toolCalls: [],
			finishReason: 'stop',
			rawAssistantMessage: { content: 'Answer from Codex' },
		});

		const result = await sendToAI(
			'openai',
			'sk-test',
			'codex-mini-latest',
			'Explain',
			'Title',
			'Body',
		);

		expect(mockedStreamOpenAI).toHaveBeenCalledTimes(1);
		expect(mockedStreamClaude).not.toHaveBeenCalled();
		expect(result.content).toBe('Answer from Codex');
	});

	it('passes system prompt with note context to provider', async () => {
		mockedStreamOpenAI.mockResolvedValue({
			textContent: 'ok',
			toolCalls: [],
			finishReason: 'stop',
			rawAssistantMessage: { content: 'ok' },
		});

		await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'My Title', 'My Body', {
			currentNoteId: 'n1',
			currentNoteTitle: 'My Title',
			workMode: 'ask',
		});

		const messages = mockedStreamOpenAI.mock.calls[0][2];
		const fullSystem = messages
			.filter((m: { role: string }) => m.role === 'system')
			.map((m: { content?: string | null }) => m.content ?? '')
			.join('');
		expect(fullSystem).toContain('Current note title: My Title');
		expect(fullSystem).toContain('My Body');
	});

	it('executes tool calls and returns action outcomes', async () => {
		mockedStreamOpenAI
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [
					{
						id: 'call_1',
						name: 'create_note',
						args: { title: 'New Note', body: '# Hello' },
					},
				],
				finishReason: 'tool_calls',
				rawAssistantMessage: {
					content: null,
					tool_calls: [
						{
							id: 'call_1',
							type: 'function',
							function: {
								name: 'create_note',
								arguments: '{"title":"New Note","body":"# Hello"}',
							},
						},
					],
				},
			})
			.mockResolvedValueOnce({
				textContent: 'I created a new note called "New Note".',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: {
					content: 'I created a new note called "New Note".',
				},
			});

		mockedExecuteAction.mockResolvedValue({
			success: true,
			message: 'Note "New Note" created',
			data: { id: 'note-123', title: 'New Note' },
		});

		const result = await sendToAI(
			'openai',
			'sk-test',
			'gpt-4o',
			'create a new note',
			'Title',
			'Body',
			{ currentNoteId: 'curr-1', currentNoteTitle: 'Title' },
		);

		expect(mockedExecuteAction).toHaveBeenCalledWith(
			'create_note',
			{ title: 'New Note', body: '# Hello' },
			expect.objectContaining({ currentNoteId: 'curr-1', currentNoteTitle: 'Title' }),
		);
		expect(result.actions).toHaveLength(1);
		expect(result.actions[0]).toEqual({
			action: 'create_note',
			success: true,
			message: 'Note "New Note" created',
			data: { id: 'note-123', title: 'New Note' },
		});
		expect(result.content).toBe('I created a new note called "New Note".');
	});

	it('sets isEdit=true when update_note tool succeeds', async () => {
		mockedStreamClaude
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [
					{
						id: 'tc_1',
						name: 'update_note',
						args: { body: '# Updated body' },
					},
				],
				finishReason: 'tool_use',
				rawAssistantMessage: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'tc_1',
							name: 'update_note',
							input: { body: '# Updated body' },
						},
					],
				},
			})
			.mockResolvedValueOnce({
				textContent: 'Done, I updated the note.',
				toolCalls: [],
				finishReason: 'end_turn',
				rawAssistantMessage: { role: 'assistant', content: [] },
			});

		mockedExecuteAction.mockResolvedValue({
			success: true,
			message: 'Note "My Note" updated',
		});

		const result = await sendToAI(
			'claude',
			'sk-ant-test',
			'claude-sonnet-4-6',
			'rewrite the note',
			'My Note',
			'old body',
			{ currentNoteId: 'n1', currentNoteTitle: 'My Note' },
		);

		expect(result.isEdit).toBe(true);
		expect(result.actions[0].action).toBe('update_note');
	});

	it('handles multiple tool calls in a single round', async () => {
		mockedStreamOpenAI
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [
					{ id: 'tc_a', name: 'search_notes', args: { query: 'meeting' } },
					{ id: 'tc_b', name: 'list_notebooks', args: {} },
				],
				finishReason: 'tool_calls',
				rawAssistantMessage: { content: null, tool_calls: [] },
			})
			.mockResolvedValueOnce({
				textContent: 'Found results and listed notebooks.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'Found results and listed notebooks.' },
			});

		mockedExecuteAction
			.mockResolvedValueOnce({
				success: true,
				message: 'Found 3 note(s)',
				data: { notes: [] },
			})
			.mockResolvedValueOnce({
				success: true,
				message: 'Found 2 notebook(s)',
				data: { notebooks: [] },
			});

		const result = await sendToAI(
			'openai',
			'sk-test',
			'gpt-4o',
			'find meeting notes and list folders',
			'Title',
			'Body',
			{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
		);

		expect(mockedExecuteAction).toHaveBeenCalledTimes(2);
		expect(result.actions).toHaveLength(2);
		expect(result.actions[0].action).toBe('search_notes');
		expect(result.actions[1].action).toBe('list_notebooks');
	});

	it('handles multi-round tool calling', async () => {
		mockedStreamOpenAI
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [{ id: 'tc_1', name: 'search_notes', args: { query: 'draft' } }],
				finishReason: 'tool_calls',
				rawAssistantMessage: { content: null, tool_calls: [] },
			})
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [{ id: 'tc_2', name: 'get_note', args: { noteId: 'found-1' } }],
				finishReason: 'tool_calls',
				rawAssistantMessage: { content: null, tool_calls: [] },
			})
			.mockResolvedValueOnce({
				textContent: 'Here is what I found in the draft note.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'Here is what I found in the draft note.' },
			});

		mockedExecuteAction
			.mockResolvedValueOnce({
				success: true,
				message: 'Found 1 note(s)',
				data: { notes: [{ id: 'found-1', title: 'Draft' }] },
			})
			.mockResolvedValueOnce({
				success: true,
				message: 'Read note "Draft"',
				data: { id: 'found-1', title: 'Draft', body: 'draft content' },
			});

		const result = await sendToAI(
			'openai',
			'sk-test',
			'gpt-4o',
			'find and read my draft',
			'Title',
			'Body',
			{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
		);

		expect(mockedStreamOpenAI).toHaveBeenCalledTimes(3);
		expect(mockedExecuteAction).toHaveBeenCalledTimes(2);
		expect(result.actions).toHaveLength(2);
		expect(result.actions[0].action).toBe('search_notes');
		expect(result.actions[1].action).toBe('get_note');
		expect(result.content).toBe('Here is what I found in the draft note.');
	});

	it('isEdit=false when no update_note action', async () => {
		mockedStreamOpenAI
			.mockResolvedValueOnce({
				textContent: null,
				toolCalls: [{ id: 'tc_1', name: 'add_tag', args: { tag: 'important' } }],
				finishReason: 'tool_calls',
				rawAssistantMessage: { content: null, tool_calls: [] },
			})
			.mockResolvedValueOnce({
				textContent: 'Tag added.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'Tag added.' },
			});

		mockedExecuteAction.mockResolvedValue({
			success: true,
			message: 'Tag "important" added',
		});

		const result = await sendToAI(
			'openai',
			'sk-test',
			'gpt-4o',
			'tag this as important',
			'Title',
			'Body',
			{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
		);

		expect(result.isEdit).toBe(false);
		expect(result.actions[0].action).toBe('add_tag');
	});

	it('propagates errors from the provider', async () => {
		mockedStreamOpenAI.mockRejectedValue(new Error('Rate limit exceeded'));

		await expect(sendToAI('openai', 'sk-test', 'gpt-4o', 'test', 'T', 'B')).rejects.toThrow(
			'Rate limit exceeded',
		);
	});

	describe('with notebooks in context', () => {
		const notebookContext = {
			currentNoteId: 'n1',
			currentNoteTitle: 'Title',
			notebooks: [
				{ id: 'f1', title: 'Work' },
				{ id: 'f2', title: 'Personal' },
			],
		};

		it('includes notebooks in the system prompt passed to OpenAI', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'ok' },
			});

			await sendToAI(
				'openai',
				'sk-test',
				'gpt-4o',
				'create a note about work',
				'Title',
				'Body',
				notebookContext,
			);

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			const fullSystem = messages
				.filter((m: { role: string }) => m.role === 'system')
				.map((m: { content?: string | null }) => m.content ?? '')
				.join('');
			expect(fullSystem).toContain('Work');
			expect(fullSystem).toContain('f1');
			expect(fullSystem).toContain('Personal');
			expect(fullSystem).toContain('f2');
		});

		it('includes notebooks in the system prompt passed to Claude', async () => {
			mockedStreamClaude.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'end_turn',
				rawAssistantMessage: { role: 'assistant', content: [] },
			});

			await sendToAI(
				'claude',
				'sk-ant-test',
				'claude-sonnet-4-6',
				'create a note about work',
				'Title',
				'Body',
				notebookContext,
			);

			const systemParam = mockedStreamClaude.mock.calls[0][2];
			const systemText = Array.isArray(systemParam)
				? systemParam.map((b: { text: string }) => b.text).join('')
				: (systemParam as string);
			expect(systemText).toContain('Work');
			expect(systemText).toContain('f1');
			expect(systemText).toContain('Personal');
			expect(systemText).toContain('f2');
		});

		it('does not include notebook section when context has no notebooks', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'ok' },
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
			});

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			const systemMessage = messages.find((m: { role: string }) => m.role === 'system') as {
				content: string;
			};
			expect(systemMessage.content).not.toContain('Available notebooks');
		});
	});

	describe('with agent role in context', () => {
		it('includes agent role prompt in system prompt for OpenAI', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'ok' },
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
				agentRolePrompt: 'You are a creative writer',
			});

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			const systemMessage = messages.find((m: { role: string }) => m.role === 'system') as {
				content: string;
			};
			expect(systemMessage.content).toContain('You are a creative writer');
		});

		it('includes agent role prompt in system prompt for Claude', async () => {
			mockedStreamClaude.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'end_turn',
				rawAssistantMessage: { role: 'assistant', content: [] },
			});

			await sendToAI('claude', 'sk-ant-test', 'claude-sonnet-4-6', 'hello', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
				agentRolePrompt: 'You are a creative writer',
			});

			const systemParam = mockedStreamClaude.mock.calls[0][2];
			const systemText = Array.isArray(systemParam)
				? systemParam.map((b: { text: string }) => b.text).join('')
				: (systemParam as string);
			expect(systemText).toContain('You are a creative writer');
		});

		it('does not include agent role section when context has no agentRolePrompt', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'ok' },
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
			});

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			const systemMessage = messages.find((m: { role: string }) => m.role === 'system') as {
				content: string;
			};
			expect(systemMessage.content).not.toContain('Agent Role');
		});
	});

	describe('base64 PDF multimodal messages', () => {
		it('sends multimodal user message to OpenAI when attachedFiles include base64 PDF', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'I read the PDF.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'I read the PDF.' },
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'summarize this', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
				attachedFiles: [
					{
						name: 'report.pdf',
						content: '[PDF document]',
						mimeType: 'application/pdf',
						size: 5000,
						base64Data: 'JVBERi0xLjQ=',
					},
				],
			});

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			const userMsg = messages[messages.length - 1];
			expect(userMsg.role).toBe('user');
			expect(Array.isArray(userMsg.content)).toBe(true);
			expect(userMsg.content).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: 'file' }),
					expect.objectContaining({ type: 'text', text: 'summarize this' }),
				]),
			);
		});

		it('sends multimodal user message to Claude when attachedFiles include base64 PDF', async () => {
			mockedStreamClaude.mockResolvedValue({
				textContent: 'I read the PDF.',
				toolCalls: [],
				finishReason: 'end_turn',
				rawAssistantMessage: { role: 'assistant', content: [] },
			});

			await sendToAI(
				'claude',
				'sk-ant-test',
				'claude-sonnet-4-6',
				'summarize this',
				'Title',
				'Body',
				{
					currentNoteId: 'n1',
					currentNoteTitle: 'Title',
					attachedFiles: [
						{
							name: 'report.pdf',
							content: '[PDF document]',
							mimeType: 'application/pdf',
							size: 5000,
							base64Data: 'JVBERi0xLjQ=',
						},
					],
				},
			);

			const messages = mockedStreamClaude.mock.calls[0][3];
			const userMsg = messages[messages.length - 1];
			expect(userMsg.role).toBe('user');
			expect(Array.isArray(userMsg.content)).toBe(true);
			expect(userMsg.content).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ type: 'document' }),
					expect.objectContaining({ type: 'text', text: 'summarize this' }),
				]),
			);
		});

		it('sends plain text user message when attachedFiles have no base64 PDFs', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'ok' },
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
				attachedFiles: [
					{
						name: 'data.csv',
						content: 'col1,col2\n1,2',
						mimeType: 'text/csv',
						size: 14,
					},
				],
			});

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			const userMsg = messages[messages.length - 1];
			expect(userMsg.role).toBe('user');
			expect(typeof userMsg.content).toBe('string');
			expect(userMsg.content).toBe('hello');
		});
	});

	describe('conversation history', () => {
		const mockHistory: ChatMessage[] = [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
		];

		it('prepends history messages before user prompt for OpenAI', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'I remember our conversation.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'I remember our conversation.' },
			});

			await sendToAI(
				'openai',
				'sk-test',
				'gpt-4o',
				'What did I say earlier?',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
				mockHistory,
			);

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			expect(messages[0].role).toBe('system');
			expect(messages[1].role).toBe('system');
			expect(messages[2].role).toBe('system');
			expect(messages[3]).toEqual({ role: 'user', content: 'Hello' });
			expect(messages[4]).toEqual({ role: 'assistant', content: 'Hi there!' });
			expect(messages[5]).toEqual({ role: 'user', content: 'What did I say earlier?' });
		});

		it('prepends history messages before user prompt for Claude', async () => {
			mockedStreamClaude.mockResolvedValue({
				textContent: 'I recall you said hello.',
				toolCalls: [],
				finishReason: 'end_turn',
				rawAssistantMessage: { role: 'assistant', content: [] },
			});

			await sendToAI(
				'claude',
				'sk-ant-test',
				'claude-sonnet-4-6',
				'What did I say?',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
				mockHistory,
			);

			const messages = mockedStreamClaude.mock.calls[0][3];
			expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
			expect(messages[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
			expect(messages[2]).toEqual({ role: 'user', content: 'What did I say?' });
		});

		it('works without history (backward compatible)', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'ok' },
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'Title', 'Body');

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			expect(messages).toHaveLength(4);
			expect(messages[0].role).toBe('system');
			expect(messages[1].role).toBe('system');
			expect(messages[2].role).toBe('system');
			expect(messages[3]).toEqual({ role: 'user', content: 'hello' });
		});

		it('works with empty history array', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'ok' },
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'Title', 'Body', undefined, []);

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			expect(messages).toHaveLength(4);
			expect(messages[0].role).toBe('system');
			expect(messages[1].role).toBe('system');
			expect(messages[2].role).toBe('system');
			expect(messages[3]).toEqual({ role: 'user', content: 'hello' });
		});
	});

	describe('Perplexity provider (Agent API — sonar)', () => {
		it('routes sonar to Agent API (sendPerplexityRequest)', async () => {
			mockedSendPerplexity.mockResolvedValue({
				textContent: 'Answer from Perplexity',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: [],
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar',
				'What is this?',
				'Title',
				'Body',
			);

			expect(mockedSendPerplexity).toHaveBeenCalledTimes(1);
			expect(mockedSendSonarChat).not.toHaveBeenCalled();
			expect(mockedStreamOpenAI).not.toHaveBeenCalled();
			expect(mockedStreamClaude).not.toHaveBeenCalled();
			expect(result.isEdit).toBe(false);
			expect(result.content).toBe('Answer from Perplexity');
			expect(result.actions).toEqual([]);
		});

		it('passes system prompt as instructions to Perplexity Agent API', async () => {
			mockedSendPerplexity.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: [],
			});

			await sendToAI('perplexity', 'pplx-test-key', 'sonar', 'hello', 'My Title', 'My Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'My Title',
				workMode: 'ask',
			});

			const instructions = mockedSendPerplexity.mock.calls[0][3] as string;
			expect(instructions).toContain('Current note title: My Title');
			expect(instructions).toContain('My Body');
		});

		it('executes tool calls with Perplexity Agent API', async () => {
			mockedSendPerplexity
				.mockResolvedValueOnce({
					textContent: null,
					toolCalls: [
						{
							id: 'call_pplx_1',
							name: 'search_notes',
							args: { query: 'meeting' },
						},
					],
					finishReason: 'tool_calls',
					rawAssistantMessage: [
						{
							type: 'function_call',
							call_id: 'call_pplx_1',
							name: 'search_notes',
							arguments: '{"query":"meeting"}',
						},
					],
				})
				.mockResolvedValueOnce({
					textContent: 'Found your meeting notes.',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: [
						{
							type: 'message',
							content: [{ type: 'output_text', text: 'Found your meeting notes.' }],
						},
					],
				});

			mockedExecuteAction.mockResolvedValue({
				success: true,
				message: 'Found 2 note(s)',
				data: { notes: [] },
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar',
				'find meeting notes',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
			);

			expect(mockedExecuteAction).toHaveBeenCalledWith(
				'search_notes',
				{ query: 'meeting' },
				expect.objectContaining({ currentNoteId: 'n1', currentNoteTitle: 'Title' }),
			);
			expect(result.actions).toHaveLength(1);
			expect(result.actions[0].action).toBe('search_notes');
			expect(result.content).toBe('Found your meeting notes.');
		});

		it('returns accumulated token usage for sonar (Agent API)', async () => {
			mockedSendPerplexity.mockResolvedValue({
				textContent: 'Answer from Perplexity',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: [],
				usage: { inputTokens: 250, outputTokens: 75 },
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar',
				'What is this?',
				'Title',
				'Body',
			);

			expect(result.usage).toEqual({ inputTokens: 250, outputTokens: 75 });
		});

		it('validates API key for Perplexity', async () => {
			await expect(sendToAI('perplexity', '', 'sonar', 'hello', 'Title', 'Body')).rejects.toThrow(
				'API key for perplexity is not configured',
			);
			expect(mockedSendPerplexity).not.toHaveBeenCalled();
		});

		it('includes notebooks in instructions for Perplexity Agent API', async () => {
			mockedSendPerplexity.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: [],
			});

			await sendToAI('perplexity', 'pplx-test-key', 'sonar', 'create a note', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
				notebooks: [{ id: 'f1', title: 'Work' }],
			});

			const instructions = mockedSendPerplexity.mock.calls[0][3] as string;
			expect(instructions).toContain('Work');
			expect(instructions).toContain('f1');
		});

		it('passes nativeWebSearch system prompt to Perplexity (no web_search bullet)', async () => {
			mockedSendPerplexity.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: [],
			});

			await sendToAI('perplexity', 'pplx-test-key', 'sonar', 'hello', 'My Title', 'My Body');

			const instructions = mockedSendPerplexity.mock.calls[0][3] as string;
			expect(instructions).not.toMatch(/^- web_search:/m);
			expect(instructions).toMatch(/native.*web search|built-in.*search/i);
		});

		it('includes web_search bullet in system prompt for non-native Perplexity models', async () => {
			mockedSendPerplexity.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: [],
			});

			await sendToAI(
				'perplexity',
				'pplx-test-key',
				'openai/gpt-5.4',
				'hello',
				'My Title',
				'My Body',
			);

			const instructions = mockedSendPerplexity.mock.calls[0][3] as string;
			expect(instructions).toMatch(/^- web_search:/m);
		});

		it('passes web_search bullet in system prompt for OpenAI (not native)', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'ok' },
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'My Title', 'My Body');

			const messages = mockedStreamOpenAI.mock.calls[0][2];
			const systemMessage = messages.find((m: { role: string }) => m.role === 'system') as {
				content: string;
			};
			expect(systemMessage.content).toMatch(/^- web_search:/m);
		});

		it('passes history as input array for Perplexity Agent API', async () => {
			mockedSendPerplexity.mockResolvedValue({
				textContent: 'I recall that.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: [],
			});

			const mockHistory: ChatMessage[] = [
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi there!' },
			];

			await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar',
				'What did I say?',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
				mockHistory,
			);

			const input = mockedSendPerplexity.mock.calls[0][2];
			expect(Array.isArray(input)).toBe(true);
			expect(input[0]).toEqual({ role: 'user', content: 'Hello' });
			expect(input[1]).toEqual({ role: 'assistant', content: 'Hi there!' });
			expect(input[2]).toEqual({ role: 'user', content: 'What did I say?' });
		});
	});

	describe('Perplexity provider (Sonar API — sonar-pro)', () => {
		it('routes sonar-pro to Sonar API (sendSonarChatRequest)', async () => {
			mockedSendSonarChat.mockResolvedValue({
				textContent: 'Answer from Sonar Pro',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { role: 'assistant', content: 'Answer from Sonar Pro' },
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'What is this?',
				'Title',
				'Body',
			);

			expect(mockedSendSonarChat).toHaveBeenCalledTimes(1);
			expect(mockedSendPerplexity).not.toHaveBeenCalled();
			expect(result.content).toBe('Answer from Sonar Pro');
			expect(result.actions).toEqual([]);
		});

		it('routes sonar-reasoning-pro to Sonar API', async () => {
			mockedSendSonarChat.mockResolvedValue({
				textContent: 'Reasoned answer',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { role: 'assistant', content: 'Reasoned answer' },
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-reasoning-pro',
				'Explain',
				'Title',
				'Body',
			);

			expect(mockedSendSonarChat).toHaveBeenCalledTimes(1);
			expect(mockedSendPerplexity).not.toHaveBeenCalled();
			expect(result.content).toBe('Reasoned answer');
		});

		it('routes sonar-deep-research to Sonar API', async () => {
			mockedSendSonarChat.mockResolvedValue({
				textContent: 'Deep research answer',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { role: 'assistant', content: 'Deep research answer' },
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-deep-research',
				'Research this',
				'Title',
				'Body',
			);

			expect(mockedSendSonarChat).toHaveBeenCalledTimes(1);
			expect(result.content).toBe('Deep research answer');
		});

		it('passes nativeWebSearch system prompt to Sonar API (no web_search bullet)', async () => {
			mockedSendSonarChat.mockResolvedValue({
				textContent: 'ok',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { role: 'assistant', content: 'ok' },
			});

			await sendToAI('perplexity', 'pplx-test-key', 'sonar-pro', 'hello', 'My Title', 'My Body');

			const messages = mockedSendSonarChat.mock.calls[0][2];
			const systemMsg = messages[0] as { role: string; content: string };
			expect(systemMsg.role).toBe('system');
			expect(systemMsg.content).not.toMatch(/^- web_search:/m);
			expect(systemMsg.content).toMatch(/native.*web search|built-in.*search/i);
		});

		it('passes system prompt and history as messages to Sonar API', async () => {
			mockedSendSonarChat.mockResolvedValue({
				textContent: 'I recall.',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { role: 'assistant', content: 'I recall.' },
			});

			const mockHistory: ChatMessage[] = [
				{ role: 'user', content: 'Hello' },
				{ role: 'assistant', content: 'Hi!' },
			];

			await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'What did I say?',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
				mockHistory,
			);

			const messages = mockedSendSonarChat.mock.calls[0][2];
			expect(messages[0].role).toBe('system');
			expect(messages[0].content).toContain('Current note title: Title');
			expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
			expect(messages[2]).toEqual({ role: 'assistant', content: 'Hi!' });
			expect(messages[3]).toEqual({ role: 'user', content: 'What did I say?' });
		});

		it('executes tool calls when sonar-pro outputs TOOL_CALL markers', async () => {
			mockedSendSonarChat
				.mockResolvedValueOnce({
					textContent:
						'Let me update that.\n[TOOL_CALL]{"name":"update_note","args":{"body":"# Updated"}}[/TOOL_CALL]',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: {
						role: 'assistant',
						content:
							'Let me update that.\n[TOOL_CALL]{"name":"update_note","args":{"body":"# Updated"}}[/TOOL_CALL]',
					},
				})
				.mockResolvedValueOnce({
					textContent: 'Done, I updated the note.',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: { role: 'assistant', content: 'Done, I updated the note.' },
				});

			mockedExecuteAction.mockResolvedValue({
				success: true,
				message: 'Note "Title" body updated',
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'update the note',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
			);

			expect(mockedExecuteAction).toHaveBeenCalledWith(
				'update_note',
				{ body: '# Updated' },
				expect.objectContaining({ currentNoteId: 'n1' }),
			);
			expect(result.actions).toHaveLength(1);
			expect(result.actions[0].action).toBe('update_note');
			expect(result.actions[0].success).toBe(true);
			expect(result.content).toBe('Done, I updated the note.');
		});

		it('sets isEdit=true when sonar-pro successfully calls update_note', async () => {
			mockedSendSonarChat
				.mockResolvedValueOnce({
					textContent: '[TOOL_CALL]{"name":"update_note","args":{"body":"new"}}[/TOOL_CALL]',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: {
						role: 'assistant',
						content: '[TOOL_CALL]{"name":"update_note","args":{"body":"new"}}[/TOOL_CALL]',
					},
				})
				.mockResolvedValueOnce({
					textContent: 'Updated.',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: { role: 'assistant', content: 'Updated.' },
				});

			mockedExecuteAction.mockResolvedValue({
				success: true,
				message: 'Note updated',
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'rewrite this',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
			);

			expect(result.isEdit).toBe(true);
		});

		it('returns plain text when sonar-pro does not use tool calls', async () => {
			mockedSendSonarChat.mockResolvedValue({
				textContent: 'Just a chat response',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { role: 'assistant', content: 'Just a chat response' },
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'what is this note about?',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
			);

			expect(result.actions).toEqual([]);
			expect(result.isEdit).toBe(false);
			expect(result.content).toBe('Just a chat response');
		});

		it('handles multi-round tool calling for sonar-pro', async () => {
			mockedSendSonarChat
				.mockResolvedValueOnce({
					textContent: '[TOOL_CALL]{"name":"search_notes","args":{"query":"meeting"}}[/TOOL_CALL]',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: {
						role: 'assistant',
						content: '[TOOL_CALL]{"name":"search_notes","args":{"query":"meeting"}}[/TOOL_CALL]',
					},
				})
				.mockResolvedValueOnce({
					textContent: '[TOOL_CALL]{"name":"get_note","args":{"noteId":"found-1"}}[/TOOL_CALL]',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: {
						role: 'assistant',
						content: '[TOOL_CALL]{"name":"get_note","args":{"noteId":"found-1"}}[/TOOL_CALL]',
					},
				})
				.mockResolvedValueOnce({
					textContent: 'Found your meeting notes: draft content.',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: {
						role: 'assistant',
						content: 'Found your meeting notes: draft content.',
					},
				});

			mockedExecuteAction
				.mockResolvedValueOnce({
					success: true,
					message: 'Found 1 note(s)',
					data: { notes: [{ id: 'found-1', title: 'Meeting' }] },
				})
				.mockResolvedValueOnce({
					success: true,
					message: 'Read note "Meeting"',
					data: { id: 'found-1', title: 'Meeting', body: 'draft content' },
				});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'find and read my meeting notes',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
			);

			expect(mockedSendSonarChat).toHaveBeenCalledTimes(3);
			expect(mockedExecuteAction).toHaveBeenCalledTimes(2);
			expect(result.actions).toHaveLength(2);
			expect(result.actions[0].action).toBe('search_notes');
			expect(result.actions[1].action).toBe('get_note');
			expect(result.content).toBe('Found your meeting notes: draft content.');
		});

		it('routes valid JSON write tool (missing args) through executeAction in Ask mode', async () => {
			mockedSendSonarChat
				.mockResolvedValueOnce({
					textContent: '[TOOL_CALL]{"name":"update_note"}[/TOOL_CALL]',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: {
						role: 'assistant',
						content: '[TOOL_CALL]{"name":"update_note"}[/TOOL_CALL]',
					},
				})
				.mockResolvedValueOnce({
					textContent: 'Sorry, I cannot edit in Ask mode.',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: { role: 'assistant', content: 'Sorry, I cannot edit in Ask mode.' },
				});

			mockedExecuteAction.mockResolvedValue({
				success: false,
				message: 'Action "update_note" is not allowed in Ask mode.',
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'remove word task',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title', workMode: 'ask' },
			);

			expect(mockedExecuteAction).toHaveBeenCalledWith(
				'update_note',
				{},
				expect.objectContaining({ workMode: 'ask' }),
			);
			expect(result.content).not.toContain('[TOOL_CALL]');
			expect(result.actions).toHaveLength(1);
			expect(result.actions[0].success).toBe(false);
		});

		it('returns mode error when sonar-pro emits truncated write tool in Ask mode', async () => {
			mockedSendSonarChat.mockResolvedValueOnce({
				textContent:
					'[TOOL_CALL]{"name":"update_note","args":{"body":"> 1. PAPA-2135\n> 2. PAPA-2136',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: {
					role: 'assistant',
					content: '[TOOL_CALL]{"name":"update_note","args":{"body":"truncated...',
				},
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'edit papa -> wow',
				'Bug Report',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Bug Report', workMode: 'ask' },
			);

			expect(mockedExecuteAction).not.toHaveBeenCalled();
			expect(result.content).not.toContain('[TOOL_CALL]');
			expect(result.content).toContain('update_note');
			expect(result.content).toContain('Ask');
			expect(result.actions).toHaveLength(1);
			expect(result.actions[0].success).toBe(false);
		});

		it('returns mode error when sonar-pro emits malformed JSON write tool in Ask mode', async () => {
			mockedSendSonarChat.mockResolvedValueOnce({
				textContent:
					'[TOOL_CALL]{"name":"update_note","args":{"body":"text with "quotes" inside"}}[/TOOL_CALL]',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: {
					role: 'assistant',
					content:
						'[TOOL_CALL]{"name":"update_note","args":{"body":"text with "quotes" inside"}}[/TOOL_CALL]',
				},
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'edit this note',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title', workMode: 'ask' },
			);

			expect(mockedExecuteAction).not.toHaveBeenCalled();
			expect(result.content).not.toContain('[TOOL_CALL]');
			expect(result.content).toContain('update_note');
			expect(result.content).toContain('Ask');
		});

		describe('onThinkingStep callback', () => {
			it('calls onThinkingStep with tool name when OpenAI makes tool calls', async () => {
				mockedStreamOpenAI
					.mockResolvedValueOnce({
						textContent: null,
						toolCalls: [{ id: 'call_1', name: 'search_notes', args: { query: 'test' } }],
						finishReason: 'tool_calls',
						rawAssistantMessage: {
							content: null,
							tool_calls: [
								{
									id: 'call_1',
									type: 'function',
									function: { name: 'search_notes', arguments: '{"query":"test"}' },
								},
							],
						},
					})
					.mockResolvedValueOnce({
						textContent: 'Found some notes',
						toolCalls: [],
						finishReason: 'stop',
						rawAssistantMessage: { content: 'Found some notes' },
					});

				mockedExecuteAction.mockResolvedValue({ success: true, message: 'ok' });

				const inputOnThinkingStep = jest.fn();
				await sendToAI('openai', 'sk-test', 'gpt-4o', 'search', 'Title', 'Body', {
					currentNoteId: 'n1',
					currentNoteTitle: 'Title',
					onThinkingStep: inputOnThinkingStep,
				});

				expect(inputOnThinkingStep).toHaveBeenCalledWith(
					expect.objectContaining({ step: 'search_notes' }),
				);
			});

			it('calls onThinkingStep with a human-readable label', async () => {
				mockedStreamOpenAI
					.mockResolvedValueOnce({
						textContent: null,
						toolCalls: [{ id: 'call_1', name: 'search_notes', args: { query: 'test' } }],
						finishReason: 'tool_calls',
						rawAssistantMessage: { content: null, tool_calls: [] },
					})
					.mockResolvedValueOnce({
						textContent: 'ok',
						toolCalls: [],
						finishReason: 'stop',
						rawAssistantMessage: { content: 'ok' },
					});

				mockedExecuteAction.mockResolvedValue({ success: true, message: 'ok' });

				const inputOnThinkingStep = jest.fn();
				await sendToAI('openai', 'sk-test', 'gpt-4o', 'search', 'Title', 'Body', {
					currentNoteId: 'n1',
					currentNoteTitle: 'Title',
					onThinkingStep: inputOnThinkingStep,
				});

				const actualCallArg = inputOnThinkingStep.mock.calls[0][0];
				expect(actualCallArg.label).toBeTruthy();
				expect(typeof actualCallArg.label).toBe('string');
			});

			it('calls onThinkingStep for each tool call when multiple are made', async () => {
				mockedStreamOpenAI
					.mockResolvedValueOnce({
						textContent: null,
						toolCalls: [
							{ id: 'tc_a', name: 'search_notes', args: { query: 'meeting' } },
							{ id: 'tc_b', name: 'create_note', args: { title: 'New' } },
						],
						finishReason: 'tool_calls',
						rawAssistantMessage: { content: null, tool_calls: [] },
					})
					.mockResolvedValueOnce({
						textContent: 'Done',
						toolCalls: [],
						finishReason: 'stop',
						rawAssistantMessage: { content: 'Done' },
					});

				mockedExecuteAction.mockResolvedValue({ success: true, message: 'ok' });

				const inputOnThinkingStep = jest.fn();
				await sendToAI('openai', 'sk-test', 'gpt-4o', 'search and create', 'Title', 'Body', {
					currentNoteId: 'n1',
					currentNoteTitle: 'Title',
					onThinkingStep: inputOnThinkingStep,
				});

				expect(inputOnThinkingStep).toHaveBeenCalledTimes(2);
				expect(inputOnThinkingStep).toHaveBeenNthCalledWith(
					1,
					expect.objectContaining({ step: 'search_notes' }),
				);
				expect(inputOnThinkingStep).toHaveBeenNthCalledWith(
					2,
					expect.objectContaining({ step: 'create_note' }),
				);
			});

			it('calls onThinkingStep when Claude makes tool calls', async () => {
				mockedStreamClaude
					.mockResolvedValueOnce({
						textContent: null,
						toolCalls: [{ id: 'tc_1', name: 'update_note', args: { body: 'new body' } }],
						finishReason: 'tool_use',
						rawAssistantMessage: {
							role: 'assistant',
							content: [
								{ type: 'tool_use', id: 'tc_1', name: 'update_note', input: { body: 'new body' } },
							],
						},
					})
					.mockResolvedValueOnce({
						textContent: 'Updated',
						toolCalls: [],
						finishReason: 'end_turn',
						rawAssistantMessage: { role: 'assistant', content: [] },
					});

				mockedExecuteAction.mockResolvedValue({ success: true, message: 'ok' });

				const inputOnThinkingStep = jest.fn();
				await sendToAI(
					'claude',
					'sk-ant-test',
					'claude-sonnet-4-6',
					'update the note',
					'Title',
					'Body',
					{ currentNoteId: 'n1', currentNoteTitle: 'Title', onThinkingStep: inputOnThinkingStep },
				);

				expect(inputOnThinkingStep).toHaveBeenCalledWith(
					expect.objectContaining({ step: 'update_note' }),
				);
			});

			it('does not throw when onThinkingStep is not provided', async () => {
				mockedStreamOpenAI
					.mockResolvedValueOnce({
						textContent: null,
						toolCalls: [{ id: 'call_1', name: 'search_notes', args: { query: 'test' } }],
						finishReason: 'tool_calls',
						rawAssistantMessage: { content: null, tool_calls: [] },
					})
					.mockResolvedValueOnce({
						textContent: 'ok',
						toolCalls: [],
						finishReason: 'stop',
						rawAssistantMessage: { content: 'ok' },
					});

				mockedExecuteAction.mockResolvedValue({ success: true, message: 'ok' });

				await expect(
					sendToAI('openai', 'sk-test', 'gpt-4o', 'search', 'Title', 'Body', {
						currentNoteId: 'n1',
						currentNoteTitle: 'Title',
					}),
				).resolves.not.toThrow();
			});
		});

		it('returns accumulated token usage for sonar-pro simple response', async () => {
			mockedSendSonarChat.mockResolvedValue({
				textContent: 'Answer from Sonar Pro',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { role: 'assistant', content: 'Answer from Sonar Pro' },
				usage: { inputTokens: 100, outputTokens: 30 },
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'What is this?',
				'Title',
				'Body',
			);

			expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 30 });
		});

		it('accumulates token usage across multiple tool rounds for sonar-pro', async () => {
			mockedSendSonarChat
				.mockResolvedValueOnce({
					textContent: '[TOOL_CALL]{"name":"search_notes","args":{"query":"test"}}[/TOOL_CALL]',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: {
						role: 'assistant',
						content: '[TOOL_CALL]{"name":"search_notes","args":{"query":"test"}}[/TOOL_CALL]',
					},
					usage: { inputTokens: 80, outputTokens: 20 },
				})
				.mockResolvedValueOnce({
					textContent: 'Found your notes.',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: { role: 'assistant', content: 'Found your notes.' },
					usage: { inputTokens: 120, outputTokens: 40 },
				});

			mockedExecuteAction.mockResolvedValue({
				success: true,
				message: 'Found 2 note(s)',
				data: { notes: [] },
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'search notes',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
			);

			expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 60 });
		});

		it('does not block read-only tool calls that fail to parse in Ask mode', async () => {
			mockedSendSonarChat.mockResolvedValueOnce({
				textContent: 'Let me search.\n[TOOL_CALL]{"name":"search_notes"[/TOOL_CALL]',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: {
					role: 'assistant',
					content: 'Let me search.\n[TOOL_CALL]{"name":"search_notes"[/TOOL_CALL]',
				},
			});

			const result = await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'find my notes',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title', workMode: 'ask' },
			);

			expect(result.content).not.toContain('[TOOL_CALL]');
			expect(result.content).toBe('Let me search.');
		});

		it('sends tool results back in conversation for sonar-pro', async () => {
			mockedSendSonarChat
				.mockResolvedValueOnce({
					textContent: '[TOOL_CALL]{"name":"list_notebooks","args":{}}[/TOOL_CALL]',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: {
						role: 'assistant',
						content: '[TOOL_CALL]{"name":"list_notebooks","args":{}}[/TOOL_CALL]',
					},
				})
				.mockResolvedValueOnce({
					textContent: 'You have 2 notebooks.',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: { role: 'assistant', content: 'You have 2 notebooks.' },
				});

			mockedExecuteAction.mockResolvedValue({
				success: true,
				message: 'Found 2 notebook(s)',
				data: {
					notebooks: [
						{ id: 'f1', title: 'Work' },
						{ id: 'f2', title: 'Personal' },
					],
				},
			});

			await sendToAI(
				'perplexity',
				'pplx-test-key',
				'sonar-pro',
				'list my notebooks',
				'Title',
				'Body',
				{ currentNoteId: 'n1', currentNoteTitle: 'Title' },
			);

			const secondCallMessages = mockedSendSonarChat.mock.calls[1][2];

			const toolResultMsg = secondCallMessages.find(
				(m: any) =>
					m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT'),
			);
			expect(toolResultMsg).toBeTruthy();
		});
	});

	describe('streaming on all API rounds', () => {
		it('uses streaming for follow-up rounds after tool calls with OpenAI', async () => {
			mockedStreamOpenAI
				.mockResolvedValueOnce({
					textContent: null,
					toolCalls: [{ id: 'call_1', name: 'search_notes', args: { query: 'test' } }],
					finishReason: 'tool_calls',
					rawAssistantMessage: {
						content: null,
						tool_calls: [
							{
								id: 'call_1',
								type: 'function',
								function: { name: 'search_notes', arguments: '{"query":"test"}' },
							},
						],
					},
				})
				.mockResolvedValueOnce({
					textContent: 'Found your notes.',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: { content: 'Found your notes.' },
				});

			mockedExecuteAction.mockResolvedValue({ success: true, message: 'Found 2 note(s)' });

			const onChunk = jest.fn();
			await sendToAI('openai', 'sk-test', 'gpt-4o', 'search notes', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
				onStreamChunk: onChunk,
			});

			expect(mockedStreamOpenAI).toHaveBeenCalledTimes(2);
		});

		it('uses streaming for follow-up rounds after tool calls with Claude', async () => {
			mockedStreamClaude
				.mockResolvedValueOnce({
					textContent: null,
					toolCalls: [{ id: 'tc_1', name: 'update_note', args: { body: 'new' } }],
					finishReason: 'tool_use',
					rawAssistantMessage: {
						role: 'assistant',
						content: [
							{ type: 'tool_use', id: 'tc_1', name: 'update_note', input: { body: 'new' } },
						],
					},
				})
				.mockResolvedValueOnce({
					textContent: 'Updated the note.',
					toolCalls: [],
					finishReason: 'end_turn',
					rawAssistantMessage: { role: 'assistant', content: [] },
				});

			mockedExecuteAction.mockResolvedValue({ success: true, message: 'Note updated' });

			const onChunk = jest.fn();
			await sendToAI('claude', 'sk-ant-test', 'claude-sonnet-4-6', 'update note', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
				onStreamChunk: onChunk,
			});

			expect(mockedStreamClaude).toHaveBeenCalledTimes(2);
		});

		it('uses streaming even when onStreamChunk is not provided', async () => {
			mockedStreamOpenAI.mockResolvedValue({
				textContent: 'Plain answer',
				toolCalls: [],
				finishReason: 'stop',
				rawAssistantMessage: { content: 'Plain answer' },
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'hello', 'Title', 'Body');

			expect(mockedStreamOpenAI).toHaveBeenCalledTimes(1);
		});
	});

	describe('parallel tool execution', () => {
		it('executes independent tool calls concurrently', async () => {
			const executionOrder: string[] = [];

			mockedStreamOpenAI
				.mockResolvedValueOnce({
					textContent: null,
					toolCalls: [
						{ id: 'tc_a', name: 'search_notes', args: { query: 'meeting' } },
						{ id: 'tc_b', name: 'list_notebooks', args: {} },
					],
					finishReason: 'tool_calls',
					rawAssistantMessage: { content: null, tool_calls: [] },
				})
				.mockResolvedValueOnce({
					textContent: 'Done',
					toolCalls: [],
					finishReason: 'stop',
					rawAssistantMessage: { content: 'Done' },
				});

			mockedExecuteAction.mockImplementation(async (name: string) => {
				executionOrder.push(`start:${name}`);
				await new Promise((resolve) => setTimeout(resolve, 10));
				executionOrder.push(`end:${name}`);
				return { success: true, message: 'ok' };
			});

			await sendToAI('openai', 'sk-test', 'gpt-4o', 'search and list', 'Title', 'Body', {
				currentNoteId: 'n1',
				currentNoteTitle: 'Title',
			});

			expect(executionOrder[0]).toBe('start:search_notes');
			expect(executionOrder[1]).toBe('start:list_notebooks');
		});
	});
});

describe('buildSystemPrompt with noteBodyOmitted', () => {
	it('omits body section entirely when noteBodyOmitted is true', () => {
		const prompt = buildSystemPrompt({
			noteTitle: 'Test',
			noteBody: '',
			noteBodyOmitted: true,
		});
		expect(prompt).not.toContain('not loaded');
		expect(prompt).not.toContain('Current note content:');
		expect(prompt).not.toContain('Current note body:');
		expect(prompt).toContain('get_note');
	});

	it('does not include note body when noteBodyOmitted is true', () => {
		const prompt = buildSystemPrompt({
			noteTitle: 'Test',
			noteBody: '',
			noteBodyOmitted: true,
		});
		expect(prompt).not.toContain('Current note content:');
		expect(prompt).not.toContain('Current note body:');
	});

	it('includes note title when noteBodyOmitted is true', () => {
		const prompt = buildSystemPrompt({
			noteTitle: 'My Important Note',
			noteBody: '',
			noteBodyOmitted: true,
		});
		expect(prompt).toContain('Current note title: My Important Note');
	});

	it('includes full body when noteBodyOmitted is false', () => {
		const prompt = buildSystemPrompt({
			noteTitle: 'Test',
			noteBody: 'This is the full body content',
			noteBodyOmitted: false,
		});
		expect(prompt).toContain('This is the full body content');
		expect(prompt).not.toContain('Note body omitted');
	});

	it('includes full body when noteBodyOmitted is undefined', () => {
		const prompt = buildSystemPrompt({
			noteTitle: 'Test',
			noteBody: 'Body here',
		});
		expect(prompt).toContain('Body here');
		expect(prompt).not.toContain('Note body omitted');
	});

	it('applies noteBodyOmitted in edit mode too', () => {
		const prompt = buildSystemPrompt({
			noteTitle: 'Test',
			noteBody: '',
			noteBodyOmitted: true,
			workMode: 'edit',
		});
		expect(prompt).not.toContain('not loaded');
		expect(prompt).not.toContain('Current note body:');
	});
});
