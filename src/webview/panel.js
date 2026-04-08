function initPanel() {
	var messagesEl = document.getElementById('messages');
	var promptInput = document.getElementById('promptInput');
	var executeBtn = document.getElementById('executeBtn');
	var clearBtn = document.getElementById('clearBtn');
	var noteInfoEl = document.getElementById('noteInfo');
	var emptyState = document.getElementById('emptyState');
	var isLoading = false;

	function escapeHtml(text) {
		var div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	function addMessage(type, label, content) {
		if (emptyState) {
			emptyState.style.display = 'none';
		}

		var msgDiv = document.createElement('div');
		msgDiv.className = 'message message-' + type;

		var labelDiv = document.createElement('div');
		labelDiv.className = 'message-label';
		labelDiv.textContent = label;
		msgDiv.appendChild(labelDiv);

		var contentDiv = document.createElement('div');
		contentDiv.innerHTML = escapeHtml(content);
		msgDiv.appendChild(contentDiv);

		messagesEl.appendChild(msgDiv);
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	function showLoading(show) {
		isLoading = show;
		executeBtn.disabled = show;

		var existing = document.getElementById('loadingIndicator');
		if (show && !existing) {
			var loadingDiv = document.createElement('div');
			loadingDiv.id = 'loadingIndicator';
			loadingDiv.className = 'loading';
			loadingDiv.innerHTML = '<div class="spinner"></div>AI is thinking...';
			messagesEl.appendChild(loadingDiv);
			messagesEl.scrollTop = messagesEl.scrollHeight;
		} else if (!show && existing) {
			existing.remove();
		}
	}

	function renderActions(actions) {
		if (!actions || actions.length === 0) return;
		for (var i = 0; i < actions.length; i++) {
			var a = actions[i];
			var type = a.success ? 'action-success' : 'action-error';
			var icon = a.success ? '\u2705' : '\u274C';
			addMessage(type, icon + ' ' + formatActionName(a.action), a.message);
		}
	}

	function formatActionName(name) {
		return name.replace(/_/g, ' ').replace(/\b\w/g, function (c) {
			return c.toUpperCase();
		});
	}

	function sendExecute() {
		var prompt = promptInput.value.trim();
		if (!prompt || isLoading) return;
		addMessage('user', 'You', prompt);
		promptInput.value = '';
		promptInput.style.height = 'auto';
		showLoading(true);
		webviewApi.postMessage({ type: 'execute', prompt: prompt });
	}

	executeBtn.addEventListener('click', function () {
		sendExecute();
	});

	promptInput.addEventListener('keydown', function (e) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendExecute();
		}
	});

	clearBtn.addEventListener('click', function () {
		messagesEl.innerHTML = '';
		if (emptyState) {
			messagesEl.appendChild(emptyState);
			emptyState.style.display = '';
		}
		promptInput.value = '';
		promptInput.style.height = 'auto';
	});

	promptInput.addEventListener('input', function () {
		this.style.height = 'auto';
		this.style.height = Math.min(this.scrollHeight, 150) + 'px';
	});

	webviewApi.onMessage(function (event) {
		var message = event && event.message && event.message.type ? event.message : event;
		if (!message) return;

		if (message.type === 'noteInfo') {
			noteInfoEl.textContent = message.title
				? '\u{1F4C4} ' + message.title
				: 'No note selected';
		}

		if (message.type === 'result') {
			showLoading(false);
			renderActions(message.actions);

			var hasActions = message.actions && message.actions.length > 0;
			if (message.isEdit && !hasActions) {
				addMessage('edit', '\u2705 Note Updated', 'The note has been updated with the AI response.');
			}
			if (message.content) {
				addMessage('ai', 'AI', message.content);
			}
		}

		if (message.type === 'alert') {
			showLoading(false);
			addMessage('alert', 'AI', message.message);
		}

		if (message.type === 'error') {
			showLoading(false);
			addMessage('error', 'Error', message.message);
		}

		if (message.type === 'loading') {
			showLoading(message.status);
		}
	});

	webviewApi.postMessage({ type: 'getNote' });
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initPanel);
} else {
	initPanel();
}
