/**
 * Joplin CodeMirror content script.
 *
 * Polls the plugin host every 600 ms to check whether the block editor is
 * active.  When it is, injects CSS that hides the native CodeMirror editor
 * (CM6 and legacy CM5) plus the toolbar above it.  Restores everything when
 * the block editor is disabled or the panel is closed.
 *
 * Written in plain CommonJS so it can be used directly by the CopyPlugin
 * (no extra webpack compilation step needed).
 */

/* global document, setInterval */

module.exports = {
	default: function (context) {
		return {
			plugin: function (_CodeMirror) {
				// Single <style> element we toggle on/off
				var style = document.createElement('style');
				style.id = 'joplin-block-editor-override';
				document.head.appendChild(style);

				// Hides CM6 (.cm-editor) and legacy CM5 (.CodeMirror).
				// Using visibility:hidden + pointer-events:none instead of
				// display:none so Joplin's layout doesn't collapse.
				var HIDE_CSS = [
					'.cm-editor,',
					'.CodeMirror {',
					'  visibility: hidden !important;',
					'  pointer-events: none !important;',
					'}',
				].join('\n');

				var currentActive = false;

				function applyToolbarVisibility(hide) {
					var selectors = [
						'.editor-toolbar-wrapper',
						'.toolbar-wrapper',
						'[class*="editorToolbar"]',
						'[class*="EditorToolbar"]',
					];
					for (var i = 0; i < selectors.length; i++) {
						var els = document.querySelectorAll(selectors[i]);
						for (var j = 0; j < els.length; j++) {
							els[j].style.visibility = hide ? 'hidden' : '';
							els[j].style.pointerEvents = hide ? 'none' : '';
						}
					}
				}

				function applyState(active) {
					if (active === currentActive) return;
					currentActive = active;
					style.textContent = active ? HIDE_CSS : '';
					applyToolbarVisibility(active);
				}

				function poll() {
					context
						.postMessage({ type: 'getBlockEditorState' })
						.then(function (resp) {
							applyState(!!(resp && resp.active));
						})
						.catch(function () {
							// Ignore transient errors during note switching / init
						});
				}

				poll();
				setInterval(poll, 600);

				// Track text selection within the editor and report it to the plugin host.
				var selectionDebounceTimer = null;

				function isNodeInEditor(node) {
					if (!node) return false;
					var el = node.nodeType === 3 ? node.parentElement : node;
					return !!(el && (el.closest('.cm-editor') || el.closest('.CodeMirror')));
				}

				function reportSelection() {
					var sel = document.getSelection();
					if (!sel || sel.isCollapsed) {
						context.postMessage({ type: 'selectionChange', text: '' }).catch(function () {});
						return;
					}
					if (!isNodeInEditor(sel.anchorNode)) return;
					var selectedText = sel.toString();
					context.postMessage({ type: 'selectionChange', text: selectedText }).catch(function () {});
				}

				document.addEventListener('selectionchange', function () {
					clearTimeout(selectionDebounceTimer);
					selectionDebounceTimer = setTimeout(reportSelection, 150);
				});
			},
		};
	},
};
