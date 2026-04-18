/**
 * @jest-environment jsdom
 *
 * Verifies the custom slash menu was removed from block-editor.js.
 * Only the native Editor.js popover/toolbox should handle block type selection.
 */

import * as fs from 'fs';
import * as path from 'path';

const blockEditorSource = fs.readFileSync(
	path.resolve(__dirname, '..', 'block-editor.js'),
	'utf-8',
);

const cssSource = fs.readFileSync(path.resolve(__dirname, '..', 'panel.css'), 'utf-8');

describe('custom slash menu removal', () => {
	it('should not contain SLASH_ITEMS array in block-editor.js', () => {
		expect(blockEditorSource).not.toMatch(/SLASH_ITEMS/);
	});

	it('should not contain showSlashMenu function in block-editor.js', () => {
		expect(blockEditorSource).not.toMatch(/showSlashMenu/);
	});

	it('should not contain renderSlashMenu function in block-editor.js', () => {
		expect(blockEditorSource).not.toMatch(/renderSlashMenu/);
	});

	it('should not contain slash-menu CSS rules in panel.css', () => {
		expect(cssSource).not.toMatch(/#slash-menu/);
	});

	it('should not contain .slash-item CSS rules in panel.css', () => {
		expect(cssSource).not.toMatch(/\.slash-item/);
	});
});
