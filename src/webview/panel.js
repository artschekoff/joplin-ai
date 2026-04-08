function initPanel() {
	console.log('[AI Panel] initPanel called, readyState:', document.readyState);
	var messagesEl = document.getElementById('messages');
	var promptInput = document.getElementById('promptInput');
	var executeBtn = document.getElementById('executeBtn');
	var clearBtn = document.getElementById('clearBtn');
	var noteInfoEl = document.getElementById('noteInfo');
	var emptyState = document.getElementById('emptyState');
	var isLoading = false;
	console.log('[AI Panel] Elements found:', {
		messages: !!messagesEl,
		promptInput: !!promptInput,
		executeBtn: !!executeBtn,
		clearBtn: !!clearBtn,
		noteInfo: !!noteInfoEl,
		emptyState: !!emptyState
	});

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

	function sendExecute() {
		console.log('[AI Panel] sendExecute called, prompt:', JSON.stringify(promptInput.value), 'isLoading:', isLoading);
		var prompt = promptInput.value.trim();
		if (!prompt || isLoading) {
			console.log('[AI Panel] sendExecute aborted — empty prompt or loading');
			return;
		}
		addMessage('user', 'You', prompt);
		promptInput.value = '';
		promptInput.style.height = 'auto';
		showLoading(true);
		console.log('[AI Panel] posting execute message');
		webviewApi.postMessage({ type: 'execute', prompt: prompt });
	}

	executeBtn.addEventListener('click', function() {
		console.log('[AI Panel] Execute button clicked');
		sendExecute();
	});

	promptInput.addEventListener('keydown', function(e) {
		console.log('[AI Panel] keydown:', e.key, 'shift:', e.shiftKey);
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendExecute();
		}
	});

	clearBtn.addEventListener('click', function() {
		console.log('[AI Panel] Clear button clicked');
		messagesEl.innerHTML = '';
		if (emptyState) {
			messagesEl.appendChild(emptyState);
			emptyState.style.display = '';
		}
		promptInput.value = '';
		promptInput.style.height = 'auto';
		console.log('[AI Panel] Clear done — input value:', JSON.stringify(promptInput.value));
	});

	// Auto-resize textarea
	promptInput.addEventListener('input', function() {
		this.style.height = 'auto';
		this.style.height = Math.min(this.scrollHeight, 150) + 'px';
	});

	webviewApi.onMessage(function(event) {
		console.log('[AI Panel] onMessage received:', JSON.stringify(event));
		var message = event && event.message && event.message.type ? event.message : event;
		if (!message) return;

		if (message.type === 'noteInfo') {
			noteInfoEl.textContent = message.title
				? ('\u{1F4C4} ' + message.title)
				: 'No note selected';
		}

		if (message.type === 'result') {
			showLoading(false);
			if (message.isEdit) {
				addMessage('edit', '\u2705 Note Updated', 'The note has been updated with the AI response.');
			} else {
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
