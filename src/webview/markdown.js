(function () {
	'use strict';

	var escapeHtmlChars = function (text) {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	};

	var sanitizeUrl = function (url) {
		var trimmed = url.replace(/[\x00-\x1f\x7f]/g, '').trim().toLowerCase();
		if (/^(javascript|vbscript|data|file)\s*:/i.test(trimmed)) {
			return '';
		}
		return url;
	};

	var renderInline = function (text) {
		var escaped = escapeHtmlChars(text);
		escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
		escaped = escaped.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
		escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
		escaped = escaped.replace(/\*(.+?)\*/g, '<em>$1</em>');
		escaped = escaped.replace(/~~(.+?)~~/g, '<del>$1</del>');
		escaped = escaped.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			function (_match, linkText, url) {
				var safeUrl = sanitizeUrl(url);
				if (!safeUrl) return linkText;
				return (
					'<a href="' +
					safeUrl +
					'" target="_blank" rel="noopener noreferrer">' +
					linkText +
					'</a>'
				);
			},
		);
		return escaped;
	};

	window.renderMarkdown = function (text) {
		if (!text || !text.trim()) return '';

		text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\uFFFD/g, '');
		if (!text.trim()) return '';

		var lines = text.split('\n');
		var html = [];
		var i = 0;

		while (i < lines.length) {
			var line = lines[i];

			if (/^```/.test(line)) {
				var codeLines = [];
				i++;
				while (i < lines.length && !/^```/.test(lines[i])) {
					codeLines.push(escapeHtmlChars(lines[i]));
					i++;
				}
				i++;
				html.push('<pre><code>' + codeLines.join('\n') + '</code></pre>');
				continue;
			}

			if (/^#{1,6}\s/.test(line)) {
				var level = line.match(/^(#{1,6})\s/)[1].length;
				var headerText = line.replace(/^#{1,6}\s+/, '');
				html.push('<h' + level + '>' + renderInline(headerText) + '</h' + level + '>');
				i++;
				continue;
			}

			if (/^>\s/.test(line)) {
				var quoteLines = [];
				while (i < lines.length && /^>\s?/.test(lines[i])) {
					quoteLines.push(lines[i].replace(/^>\s?/, ''));
					i++;
				}
				html.push('<blockquote>' + renderInline(quoteLines.join(' ')) + '</blockquote>');
				continue;
			}

			if (/^---$/.test(line.trim()) || /^\*\*\*$/.test(line.trim()) || /^___$/.test(line.trim())) {
				html.push('<hr />');
				i++;
				continue;
			}

			if (/^[-*]\s/.test(line)) {
				var items = [];
				while (i < lines.length && /^[-*]\s/.test(lines[i])) {
					items.push('<li>' + renderInline(lines[i].replace(/^[-*]\s+/, '')) + '</li>');
					i++;
				}
				html.push('<ul>' + items.join('') + '</ul>');
				continue;
			}

			if (/^\d+\.\s/.test(line)) {
				var olItems = [];
				while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
					olItems.push('<li>' + renderInline(lines[i].replace(/^\d+\.\s+/, '')) + '</li>');
					i++;
				}
				html.push('<ol>' + olItems.join('') + '</ol>');
				continue;
			}

			if (line.trim() === '') {
				i++;
				continue;
			}

			var paraLines = [];
			while (i < lines.length && lines[i].trim() !== '' && !/^```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^>\s/.test(lines[i]) && !/^[-*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i]) && !/^---$/.test(lines[i].trim()) && !/^\*\*\*$/.test(lines[i].trim()) && !/^___$/.test(lines[i].trim())) {
				paraLines.push(lines[i]);
				i++;
			}
			if (paraLines.length > 0) {
				html.push('<p>' + renderInline(paraLines.join(' ')) + '</p>');
			}
		}

		return html.join('');
	};
})();
