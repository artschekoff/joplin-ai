function initPanel() {
	var messagesEl = document.getElementById('messages');
	var promptInput = document.getElementById('promptInput');
	var executeBtn = document.getElementById('executeBtn');
	var clearBtn = document.getElementById('clearBtn');
	var clearHistoryBtn = document.getElementById('clearHistoryBtn');
	var noteInfoEl = document.getElementById('noteInfo');
	var emptyState = document.getElementById('emptyState');
	var roleSelect = document.getElementById('roleSelect');
	var applyRoleBtn = document.getElementById('applyRoleBtn');
	var manageRolesBtn = document.getElementById('manageRolesBtn');
	var roleManageView = document.getElementById('roleManageView');
	var isLoading = false;
	var chatHistory = [];
	var lastSentPrompt = null;
	var MAX_HISTORY_MESSAGES = 50;
	var agentRoles = [];
	var appliedRole = null;
	var editingRoleId = null;
	var modeSelect = document.getElementById('modeSelect');
	var currentMode = modeSelect ? modeSelect.value : 'agent';
	var contextSizeContainer = document.getElementById('contextSizeContainer');
	var attachFileBtn = document.getElementById('attachFileBtn');
	var fileInput = document.getElementById('fileInput');
	var fileChipsEl = document.getElementById('fileChips');
	var attachedFiles = [];
	var messageQueue = [];
	var queueContainer = document.getElementById('queueContainer');
	var queueIdCounter = 0;
	function escapeHtml(text) {
		var div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	function addMessage(type, label, content, files, modelName) {
		if (emptyState) {
			emptyState.style.display = 'none';
		}

		var msgDiv = document.createElement('div');
		msgDiv.className = 'message message-' + type;

		var labelDiv = document.createElement('div');
		labelDiv.className = 'message-label';
		labelDiv.textContent = label;
		msgDiv.appendChild(labelDiv);

		if (modelName) {
			var modelLabel = document.createElement('div');
			modelLabel.className = 'message-model-label';
			modelLabel.textContent = modelName;
			msgDiv.appendChild(modelLabel);
		}

		var contentDiv = document.createElement('div');
		var isAiMessage = type === 'ai';
		if (isAiMessage && typeof window.renderMarkdown === 'function') {
			contentDiv.className = 'markdown-content';
			contentDiv.innerHTML = window.renderMarkdown(content);
		} else {
			contentDiv.innerHTML = escapeHtml(content);
		}
		msgDiv.appendChild(contentDiv);

		if (files && files.length > 0) {
			var attachmentsDiv = document.createElement('div');
			attachmentsDiv.className = 'message-attachments';
			for (var i = 0; i < files.length; i++) {
				var chip = document.createElement('span');
				chip.className = 'message-attachment-chip';
				chip.textContent = '\uD83D\uDCCE ' + files[i].name;
				attachmentsDiv.appendChild(chip);
			}
			msgDiv.appendChild(attachmentsDiv);
		}

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

	var STATE_LABELS = {
		waiting: 'Waiting in queue',
		queuing: 'Queuing',
		generating: 'Generating image',
		success: 'Complete',
	};

	function showImageProgress(progress, state) {
		if (state === 'done') {
			hideImageProgress();
			return;
		}
		var existing = document.getElementById('imageProgressBar');
		if (!existing) {
			existing = document.createElement('div');
			existing.id = 'imageProgressBar';
			existing.className = 'image-progress-bar';
			messagesEl.appendChild(existing);
		}
		var label = STATE_LABELS[state] || state;
		var pct = Math.max(0, Math.min(100, progress || 0));
		existing.innerHTML =
			'<div class="image-progress-track">' +
			'<div class="image-progress-fill" style="width:' + pct + '%"></div>' +
			'</div>' +
			'<div class="image-progress-label">' + escapeHtml(label) + ' (' + pct + '%)</div>';
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	function hideImageProgress() {
		var existing = document.getElementById('imageProgressBar');
		if (existing) existing.remove();
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

	function generateId() {
		return 'role_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
	}

	function populateRoleSelect() {
		while (roleSelect.options.length > 1) {
			roleSelect.remove(1);
		}
		for (var i = 0; i < agentRoles.length; i++) {
			var opt = document.createElement('option');
			opt.value = agentRoles[i].id;
			opt.textContent = agentRoles[i].name;
			roleSelect.appendChild(opt);
		}
		if (appliedRole) {
			roleSelect.value = appliedRole.id;
		}
	}

	function updateRoleIndicator() {
		var existing = document.querySelector('.role-active-indicator');
		if (existing) existing.remove();

		if (appliedRole) {
			var indicator = document.createElement('div');
			indicator.className = 'role-active-indicator';
			indicator.textContent = '\uD83C\uDFAD ' + appliedRole.name;
			var roleBar = document.getElementById('roleBar');
			if (roleBar) {
				roleBar.appendChild(indicator);
			}
		}
	}

	function renderManageView() {
		var html =
			'<div class="manage-header">' +
			'<h3>Manage Agent Roles</h3>' +
			'<button id="closeManageView" class="btn btn-secondary btn-sm">\u2715 Close</button>' +
			'</div>';

		html +=
			'<div class="role-form">' +
			'<input id="roleNameInput" type="text" class="role-name-input" placeholder="Role name" />' +
			'<textarea id="rolePromptInput" class="role-prompt-input" placeholder="System prompt (describe the agent\'s role and behavior)" rows="4"></textarea>' +
			'<button id="saveRoleBtn" class="btn btn-primary btn-sm">' +
			(editingRoleId ? 'Update Role' : 'Add Role') +
			'</button>' +
			'</div>';

		if (agentRoles.length > 0) {
			html += '<div class="role-list">';
			for (var i = 0; i < agentRoles.length; i++) {
				var role = agentRoles[i];
				html +=
					'<div class="role-list-item" data-role-id="' +
					escapeHtml(role.id) +
					'">' +
					'<div class="role-list-item-info">' +
					'<div class="role-list-item-name">' +
					escapeHtml(role.name) +
					'</div>' +
					'<div class="role-list-item-prompt">' +
					escapeHtml(role.systemPrompt.substring(0, 80)) +
					(role.systemPrompt.length > 80 ? '...' : '') +
					'</div>' +
					'</div>' +
					'<div class="role-list-item-actions">' +
					'<button class="edit-role-btn btn btn-secondary btn-sm" data-role-id="' +
					escapeHtml(role.id) +
					'">Edit</button>' +
					'<button class="delete-role-btn btn btn-secondary btn-sm" data-role-id="' +
					escapeHtml(role.id) +
					'">Delete</button>' +
					'</div>' +
					'</div>';
			}
			html += '</div>';
		}

		roleManageView.innerHTML = html;

		document.getElementById('closeManageView').addEventListener('click', function () {
			roleManageView.style.display = 'none';
			editingRoleId = null;
		});

		document.getElementById('saveRoleBtn').addEventListener('click', function () {
			var nameInput = document.getElementById('roleNameInput');
			var promptTextarea = document.getElementById('rolePromptInput');
			var name = nameInput.value.trim();
			var prompt = promptTextarea.value.trim();
			if (!name || !prompt) return;

			if (editingRoleId) {
				for (var i = 0; i < agentRoles.length; i++) {
					if (agentRoles[i].id === editingRoleId) {
						agentRoles[i].name = name;
						agentRoles[i].systemPrompt = prompt;
						break;
					}
				}
				editingRoleId = null;
			} else {
				agentRoles.push({ id: generateId(), name: name, systemPrompt: prompt });
			}

			webviewApi.postMessage({ type: 'saveAgentRoles', roles: agentRoles.slice() });
			nameInput.value = '';
			promptTextarea.value = '';
			renderManageView();
			populateRoleSelect();
		});

		var editBtns = document.querySelectorAll('.edit-role-btn');
		for (var e = 0; e < editBtns.length; e++) {
			editBtns[e].addEventListener('click', function () {
				var id = this.getAttribute('data-role-id');
				for (var j = 0; j < agentRoles.length; j++) {
					if (agentRoles[j].id === id) {
						editingRoleId = id;
						document.getElementById('roleNameInput').value = agentRoles[j].name;
						document.getElementById('rolePromptInput').value = agentRoles[j].systemPrompt;
						document.getElementById('saveRoleBtn').textContent = 'Update Role';
						break;
					}
				}
			});
		}

		var deleteBtns = document.querySelectorAll('.delete-role-btn');
		for (var d = 0; d < deleteBtns.length; d++) {
			deleteBtns[d].addEventListener('click', function () {
				var id = this.getAttribute('data-role-id');
				agentRoles = agentRoles.filter(function (r) {
					return r.id !== id;
				});
				if (appliedRole && appliedRole.id === id) {
					appliedRole = null;
					updateRoleIndicator();
				}
				webviewApi.postMessage({ type: 'saveAgentRoles', roles: agentRoles.slice() });
				renderManageView();
				populateRoleSelect();
			});
		}
	}

	function getContextColor(percentage) {
		if (percentage >= 85) return '#ef4444';
		if (percentage >= 60) return '#f59e0b';
		return '#22c55e';
	}

	function renderContextCircle(usedTokens, maxTokens, percentage) {
		if (!contextSizeContainer) return;
		var radius = 12;
		var circumference = 2 * Math.PI * radius;
		var offset = circumference - (percentage / 100) * circumference;
		var color = getContextColor(percentage);
		var displayPct = Math.round(percentage);

		contextSizeContainer.setAttribute(
			'title',
			'Context: ' + usedTokens + ' / ' + maxTokens + ' tokens (' + displayPct + '%)',
		);
		contextSizeContainer.innerHTML =
			'<svg class="context-size-svg" width="30" height="30" viewBox="0 0 30 30">' +
			'<circle cx="15" cy="15" r="' +
			radius +
			'" fill="none" stroke="var(--border-color)" stroke-width="3" />' +
			'<circle class="context-size-progress" cx="15" cy="15" r="' +
			radius +
			'" fill="none" stroke="' +
			color +
			'" stroke-width="3" ' +
			'stroke-dasharray="' +
			circumference +
			'" stroke-dashoffset="' +
			offset +
			'" stroke-linecap="round" ' +
			'transform="rotate(-90 15 15)" />' +
			'<text class="context-size-text" x="15" y="15" text-anchor="middle" dominant-baseline="central" ' +
			'fill="var(--text-secondary)" font-size="8" font-weight="600">' +
			displayPct +
			'%</text>' +
			'</svg>';
	}

	function renderFileChips() {
		fileChipsEl.innerHTML = '';
		for (var i = 0; i < attachedFiles.length; i++) {
			var chip = document.createElement('span');
			chip.className = 'file-chip';
			chip.setAttribute('data-file-index', String(i));
			var nameSpan = document.createElement('span');
			nameSpan.className = 'file-chip-name';
			nameSpan.textContent = attachedFiles[i].name;
			chip.appendChild(nameSpan);
			var removeBtn = document.createElement('button');
			removeBtn.className = 'file-chip-remove';
			removeBtn.textContent = '\u00D7';
			removeBtn.setAttribute('data-file-index', String(i));
			removeBtn.addEventListener('click', function () {
				var idx = parseInt(this.getAttribute('data-file-index'), 10);
				attachedFiles.splice(idx, 1);
				renderFileChips();
			});
			chip.appendChild(removeBtn);
			fileChipsEl.appendChild(chip);
		}
	}

	function clearAttachedFiles() {
		attachedFiles = [];
		renderFileChips();
	}

	var MAX_FILE_SIZE = 512 * 1024;

	function handleFileSelection() {
		var files = fileInput.files;
		if (!files || files.length === 0) return;
		var pending = files.length;
		for (var i = 0; i < files.length; i++) {
			(function (file) {
			if (file.size > MAX_FILE_SIZE) {
				addMessage('error', 'Error', 'File "' + escapeHtml(file.name) + '" exceeds 512 KB limit.');
				pending--;
				if (pending === 0) renderFileChips();
				return;
			}
			var reader = new FileReader();
			reader.onload = function () {
				attachedFiles.push({
					name: file.name,
					content: reader.result,
					mimeType: file.type || 'text/plain',
					size: file.size,
				});
				pending--;
				if (pending === 0) {
					renderFileChips();
				}
			};
			reader.onerror = function () {
				pending--;
				if (pending === 0) {
					renderFileChips();
				}
			};
			reader.readAsText(file);
			})(files[i]);
		}
		fileInput.value = '';
	}

	if (attachFileBtn) {
		attachFileBtn.addEventListener('click', function () {
			fileInput.click();
		});
	}

	if (fileInput) {
		fileInput.addEventListener('change', handleFileSelection);
	}

	function renderQueue() {
		if (!queueContainer) return;
		queueContainer.innerHTML = '';
		for (var i = 0; i < messageQueue.length; i++) {
			var item = messageQueue[i];
			var itemDiv = document.createElement('div');
			itemDiv.className = 'queue-item';
			itemDiv.setAttribute('data-queue-id', String(item.id));
			var posSpan = document.createElement('span');
			posSpan.className = 'queue-item-position';
			posSpan.textContent = String(i + 1);
			itemDiv.appendChild(posSpan);
			var textSpan = document.createElement('span');
			textSpan.className = 'queue-item-text';
			textSpan.textContent = item.prompt.length > 100 ? item.prompt.substring(0, 97) + '...' : item.prompt;
			itemDiv.appendChild(textSpan);
			var actionsDiv = document.createElement('div');
			actionsDiv.className = 'queue-item-actions';
			var editBtn = document.createElement('button');
			editBtn.className = 'queue-item-edit';
			editBtn.textContent = '\u270F';
			editBtn.title = 'Edit';
			editBtn.setAttribute('data-queue-id', String(item.id));
			editBtn.addEventListener('click', (function (qId) {
				return function () { editQueueItem(qId); };
			})(item.id));
			actionsDiv.appendChild(editBtn);
			var deleteBtn = document.createElement('button');
			deleteBtn.className = 'queue-item-delete';
			deleteBtn.textContent = '\u2715';
			deleteBtn.title = 'Delete';
			deleteBtn.setAttribute('data-queue-id', String(item.id));
			deleteBtn.addEventListener('click', (function (qId) {
				return function () { deleteQueueItem(qId); };
			})(item.id));
			actionsDiv.appendChild(deleteBtn);
			var forceBtn = document.createElement('button');
			forceBtn.className = 'queue-item-force';
			forceBtn.textContent = '\u26A1';
			forceBtn.title = 'Force push';
			forceBtn.setAttribute('data-queue-id', String(item.id));
			forceBtn.addEventListener('click', (function (qId) {
				return function () { forcePushQueueItem(qId); };
			})(item.id));
			actionsDiv.appendChild(forceBtn);
			itemDiv.appendChild(actionsDiv);
			queueContainer.appendChild(itemDiv);
		}
	}

	function addToQueue(prompt, workMode, rolePrompt, files) {
		queueIdCounter++;
		messageQueue.push({
			id: queueIdCounter,
			prompt: prompt,
			workMode: workMode,
			agentRolePrompt: rolePrompt,
			attachedFiles: files,
		});
		renderQueue();
	}

	function findQueueItem(queueId) {
		for (var i = 0; i < messageQueue.length; i++) {
			if (messageQueue[i].id === queueId) return messageQueue[i];
		}
		return null;
	}

	function deleteQueueItem(queueId) {
		messageQueue = messageQueue.filter(function (item) {
			return item.id !== queueId;
		});
		renderQueue();
	}

	function editQueueItem(queueId) {
		var item = findQueueItem(queueId);
		if (!item) return;
		promptInput.value = item.prompt;
		promptInput.focus();
		deleteQueueItem(queueId);
	}

	function forcePushQueueItem(queueId) {
		var item = findQueueItem(queueId);
		if (!item) return;
		deleteQueueItem(queueId);
		webviewApi.postMessage({ type: 'abortRequest' });
		showLoading(false);
		dispatchExecute(item.prompt, item.workMode, item.agentRolePrompt, item.attachedFiles);
	}

	function processNextInQueue() {
		if (messageQueue.length === 0) return;
		var next = messageQueue.shift();
		renderQueue();
		dispatchExecute(next.prompt, next.workMode, next.agentRolePrompt, next.attachedFiles);
	}

	function dispatchExecute(prompt, workMode, rolePrompt, files) {
		addMessage('user', 'You', prompt, files);
		showLoading(true);
		lastSentPrompt = prompt;
		var msg = {
			type: 'execute',
			prompt: prompt,
			history: chatHistory.slice(),
			workMode: workMode || currentMode,
		};
		if (rolePrompt) {
			msg.agentRolePrompt = rolePrompt;
		}
		if (files && files.length > 0) {
			msg.attachedFiles = files.slice();
		}
		webviewApi.postMessage(msg);
	}

	function sendExecute() {
		var prompt = promptInput.value.trim();
		if (!prompt) return;
		promptInput.value = '';
		promptInput.style.height = 'auto';
		var rolePrompt = appliedRole ? appliedRole.systemPrompt : undefined;
		var files = attachedFiles.length > 0 ? attachedFiles.slice() : undefined;
		if (files) clearAttachedFiles();
		if (isLoading) {
			addToQueue(prompt, currentMode, rolePrompt, files);
			return;
		}
		dispatchExecute(prompt, currentMode, rolePrompt, files);
	}

	var MODE_PLACEHOLDERS = {
		ask: 'Ask a question about your notes...',
		agent: 'What would you like to do with this note?',
		edit: 'Describe how to edit the current note...',
	};

	function updateModePlaceholder() {
		if (promptInput) {
			promptInput.placeholder = MODE_PLACEHOLDERS[currentMode] || MODE_PLACEHOLDERS.agent;
		}
	}

	if (modeSelect) {
		modeSelect.addEventListener('change', function () {
			currentMode = modeSelect.value;
			updateModePlaceholder();
		});
	}

	var autocompleteDropdown = null;
	var autocompleteActive = false;

	function getActiveNoteQuery() {
		var text = promptInput.value;
		var cursor = promptInput.selectionStart;
		var before = text.substring(0, cursor);
		var bracketMatch = before.match(/@\[([^\]]*)$/);
		if (bracketMatch) {
			var q = bracketMatch[1];
			return q.length > 0 ? q : null;
		}
		var bareMatch = before.match(/(?:^|[\s])@(\S+)$/);
		if (bareMatch) {
			return bareMatch[1];
		}
		return null;
	}

	function removeAutocompleteDropdown() {
		if (autocompleteDropdown) {
			autocompleteDropdown.remove();
			autocompleteDropdown = null;
		}
		autocompleteActive = false;
	}

	function insertNoteReference(title) {
		var text = promptInput.value;
		var cursor = promptInput.selectionStart;
		var before = text.substring(0, cursor);
		var after = text.substring(cursor);
		var bracketIdx = before.lastIndexOf('@[');
		if (bracketIdx !== -1) {
			var newBefore = before.substring(0, bracketIdx) + '@[' + title + '] ';
			promptInput.value = newBefore + after;
			promptInput.selectionStart = newBefore.length;
			promptInput.selectionEnd = newBefore.length;
		} else {
			var bareMatch = before.match(/(?:^|[\s])@(\S+)$/);
			if (bareMatch) {
				var atPos = before.lastIndexOf('@' + bareMatch[1]);
				var newBefore = before.substring(0, atPos) + '@[' + title + '] ';
				promptInput.value = newBefore + after;
				promptInput.selectionStart = newBefore.length;
				promptInput.selectionEnd = newBefore.length;
			}
		}
		removeAutocompleteDropdown();
		promptInput.focus();
	}

	function showAutocompleteDropdown(notes) {
		removeAutocompleteDropdown();
		if (!notes || notes.length === 0) return;
		autocompleteDropdown = document.createElement('div');
		autocompleteDropdown.className = 'note-autocomplete-dropdown';
		for (var i = 0; i < notes.length; i++) {
			var item = document.createElement('div');
			item.className = 'note-autocomplete-item';
			item.textContent = notes[i].title;
			item.setAttribute('data-note-id', notes[i].id);
			item.setAttribute('data-note-title', notes[i].title);
			item.addEventListener('click', function () {
				insertNoteReference(this.getAttribute('data-note-title'));
			});
			autocompleteDropdown.appendChild(item);
		}
		var wrap = promptInput.parentElement;
		if (wrap) {
			wrap.appendChild(autocompleteDropdown);
		} else {
			document.body.appendChild(autocompleteDropdown);
		}
		autocompleteActive = true;
	}

	promptInput.addEventListener('input', function () {
		this.style.height = 'auto';
		this.style.height = Math.min(this.scrollHeight, 150) + 'px';
		var query = getActiveNoteQuery();
		if (query) {
			webviewApi.postMessage({ type: 'searchNotes', query: query });
		} else {
			removeAutocompleteDropdown();
		}
	});

	applyRoleBtn.addEventListener('click', function () {
		var selectedId = roleSelect.value;
		if (!selectedId) {
			appliedRole = null;
		} else {
			for (var i = 0; i < agentRoles.length; i++) {
				if (agentRoles[i].id === selectedId) {
					appliedRole = agentRoles[i];
					break;
				}
			}
		}
		updateRoleIndicator();
	});

	manageRolesBtn.addEventListener('click', function () {
		roleManageView.style.display = '';
		renderManageView();
	});

	executeBtn.addEventListener('click', function () {
		sendExecute();
	});

	promptInput.addEventListener('keydown', function (e) {
		if (e.key === 'Escape' && autocompleteActive) {
			removeAutocompleteDropdown();
			e.preventDefault();
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendExecute();
		}
	});

	clearBtn.addEventListener('click', function () {
		promptInput.value = '';
		promptInput.style.height = 'auto';
		clearAttachedFiles();
	});

	clearHistoryBtn.addEventListener('click', function () {
		messagesEl.innerHTML = '';
		chatHistory = [];
		lastSentPrompt = null;
		messageQueue = [];
		renderQueue();
		if (emptyState) {
			messagesEl.appendChild(emptyState);
			emptyState.style.display = '';
		}
	});

	webviewApi.onMessage(function (event) {
		var message = event && event.message && event.message.type ? event.message : event;
		if (!message) return;

		if (message.type === 'noteInfo') {
			noteInfoEl.textContent = message.title ? '\u{1F4C4} ' + message.title : 'No note selected';
		}

		if (message.type === 'agentRoles') {
			agentRoles = message.roles || [];
			populateRoleSelect();
			if (roleManageView.style.display !== 'none') {
				renderManageView();
			}
		}

		if (message.type === 'imageProgress') {
			showImageProgress(message.progress, message.state);
		}

		if (message.type === 'result') {
			showLoading(false);
			hideImageProgress();
			renderActions(message.actions);

			var hasActions = message.actions && message.actions.length > 0;
			if (message.isEdit && !hasActions) {
				addMessage(
					'edit',
					'\u2705 Note Updated',
					'The note has been updated with the AI response.',
				);
			}
			if (message.content) {
				addMessage('ai', 'AI', message.content, null, message.modelName);
			}
			if (lastSentPrompt && (message.content || hasActions)) {
				var assistantContent = '';
				if (hasActions) {
					var actionSummaries = message.actions.map(function (a) {
						var status = a.success ? 'success' : 'failed';
						var summary = '[' + a.action + ': ' + status + '] ' + a.message;
						if (a.data) {
							summary += '\nData: ' + JSON.stringify(a.data);
						}
						return summary;
					});
					assistantContent = 'Actions performed:\n' + actionSummaries.join('\n');
				}
				if (message.content) {
					assistantContent = assistantContent
						? assistantContent + '\n\n' + message.content
						: message.content;
				}
				chatHistory.push({ role: 'user', content: lastSentPrompt });
				chatHistory.push({ role: 'assistant', content: assistantContent });
				if (chatHistory.length > MAX_HISTORY_MESSAGES) {
					var start = chatHistory.length - MAX_HISTORY_MESSAGES;
					if (start % 2 !== 0) start++;
					chatHistory = chatHistory.slice(start);
				}
			}
			lastSentPrompt = null;
			processNextInQueue();
		}

		if (message.type === 'alert') {
			showLoading(false);
			hideImageProgress();
			addMessage('alert', 'AI', message.message);
			lastSentPrompt = null;
			processNextInQueue();
		}

		if (message.type === 'error') {
			showLoading(false);
			hideImageProgress();
			addMessage('error', 'Error', message.message);
			lastSentPrompt = null;
			processNextInQueue();
		}

		if (message.type === 'noteSearchResults') {
			showAutocompleteDropdown(message.notes);
		}

		if (message.type === 'contextSize') {
			renderContextCircle(message.usedTokens, message.maxTokens, message.percentage);
		}

		if (message.type === 'loading') {
			showLoading(message.status);
		}
	});

	webviewApi.postMessage({ type: 'getNote' });
	webviewApi.postMessage({ type: 'getAgentRoles' });
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initPanel);
} else {
	initPanel();
}
