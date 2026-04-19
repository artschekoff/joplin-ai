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

				var tooltipStyle = document.createElement('style');
				tooltipStyle.id = 'ask-ai-tooltip-style';
				tooltipStyle.textContent = [
					'.ask-ai-tooltip:hover {',
					'  background: var(--joplin-selected-color, #e8f0fe) !important;',
					'}',
					'.ask-ai-tooltip svg { flex-shrink: 0; }',
				].join('\n');
				document.head.appendChild(tooltipStyle);

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

				// ── "Ask AI" floating tooltip ──
				var askAITooltip = document.createElement('button');
				askAITooltip.id = 'askAITooltip';
				askAITooltip.className = 'ask-ai-tooltip';
				askAITooltip.innerHTML =
					'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" ' +
					'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
					'<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/>' +
					'<line x1="12" y1="7" x2="12" y2="11"/>' +
					'<line x1="8" y1="16" x2="8" y2="16.01"/>' +
					'<line x1="16" y1="16" x2="16" y2="16.01"/></svg>' +
					'<span>Ask AI</span>';
				askAITooltip.style.cssText =
					'display:none;position:absolute;z-index:99999;' +
					'padding:4px 10px;border-radius:6px;border:1px solid var(--joplin-divider-color,#ccc);' +
					'background:var(--joplin-background-color,#fff);color:var(--joplin-color,#333);' +
					'font-size:12px;font-family:inherit;cursor:pointer;' +
					'box-shadow:0 2px 8px rgba(0,0,0,.15);' +
					'align-items:center;gap:5px;line-height:1;white-space:nowrap;';
				document.body.appendChild(askAITooltip);

				var lastSelectedText = '';

				askAITooltip.addEventListener('mousedown', function (e) {
					e.preventDefault();
					e.stopPropagation();
					if (lastSelectedText) {
						context.postMessage({ type: 'askAI', text: lastSelectedText }).catch(function () {});
					}
					askAITooltip.style.display = 'none';
				});

				function positionTooltip(sel) {
					try {
						var range = sel.getRangeAt(0);
						var rect = range.getBoundingClientRect();
						if (!rect || (rect.width === 0 && rect.height === 0)) {
							askAITooltip.style.display = 'none';
							return;
						}
						var top = rect.top + window.scrollY - askAITooltip.offsetHeight - 6;
						if (top < window.scrollY) {
							top = rect.bottom + window.scrollY + 6;
						}
						var left = rect.left + window.scrollX + rect.width / 2;
						askAITooltip.style.display = 'flex';
						var tooltipWidth = askAITooltip.offsetWidth;
						askAITooltip.style.top = top + 'px';
						askAITooltip.style.left = Math.max(4, left - tooltipWidth / 2) + 'px';
					} catch (_e) {
						askAITooltip.style.display = 'none';
					}
				}

				function reportSelection() {
					var sel = document.getSelection();
					if (!sel || sel.isCollapsed) {
						lastSelectedText = '';
						askAITooltip.style.display = 'none';
						context.postMessage({ type: 'selectionChange', text: '' }).catch(function () {});
						return;
					}
					if (!isNodeInEditor(sel.anchorNode)) {
						lastSelectedText = '';
						askAITooltip.style.display = 'none';
						return;
					}
					var selectedText = sel.toString();
					lastSelectedText = selectedText;
					context.postMessage({ type: 'selectionChange', text: selectedText }).catch(function () {});
					if (selectedText.trim().length > 0 && !currentActive) {
						positionTooltip(sel);
					} else {
						askAITooltip.style.display = 'none';
					}
				}

				document.addEventListener('selectionchange', function () {
					clearTimeout(selectionDebounceTimer);
					selectionDebounceTimer = setTimeout(reportSelection, 150);
				});
			},
		};
	},
};
