var STORAGE_KEY_HISTORY = 'joplin-ai-chat-history';
var STORAGE_KEY_MESSAGES = 'joplin-ai-messages';
var STORAGE_KEY_MODE = 'joplin-ai-mode';
var STORAGE_KEY_ROLE = 'joplin-ai-applied-role';
var STORAGE_KEY_TOTAL_COST = 'joplin-ai-total-cost';

function initPanel() {
	const messagesEl = document.getElementById('messages');
	const promptInput = document.getElementById('promptInput');
	const executeBtn = document.getElementById('executeBtn');
	const clearBtn = document.getElementById('clearBtn');
	const clearHistoryBtn = document.getElementById('clearHistoryBtn');
	const noteInfoEl = document.getElementById('noteInfo');
	const emptyState = document.getElementById('emptyState');
	const roleSelect = document.getElementById('roleSelect');
	const applyRoleBtn = document.getElementById('applyRoleBtn');
	const manageRolesBtn = document.getElementById('manageRolesBtn');
	const roleManageView = document.getElementById('roleManageView');
	const settingsBtn = document.getElementById('settingsBtn');
	const settingsManageView = document.getElementById('settingsManageView');
	var settingsPendingOpen = false;
	var lastSettingsData = null;
	let isLoading = false;
	let chatHistory = [];
	let savedMessages = [];
	let currentNoteId = null;
	let lastSentPrompt = null;
	const MAX_HISTORY_MESSAGES = 50;
	let agentRoles = [];
	let appliedRole = null;
	let editingRoleId = null;
	const modeSelect = document.getElementById('modeSelect');
	let currentMode = modeSelect ? modeSelect.value : 'agent';
	var noteBodyLength = 0;
	var selectionLength = 0;

	function persistHistory() {
		try {
			localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(chatHistory));
		} catch (_e) {}
	}

	function persistMessages() {
		try {
			localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(savedMessages));
		} catch (_e) {}
	}

	function persistMode() {
		try {
			localStorage.setItem(STORAGE_KEY_MODE, currentMode);
		} catch (_e) {}
	}

	function persistAppliedRole() {
		try {
			if (appliedRole) {
				localStorage.setItem(STORAGE_KEY_ROLE, JSON.stringify(appliedRole));
			} else {
				localStorage.removeItem(STORAGE_KEY_ROLE);
			}
		} catch (_e) {}
	}

	function clearPersistedHistory() {
		try {
			localStorage.removeItem(STORAGE_KEY_HISTORY);
			localStorage.removeItem(STORAGE_KEY_MESSAGES);
		} catch (_e) {}
	}
	const contextSizeContainer = document.getElementById('contextSizeContainer');
	const attachFileBtn = document.getElementById('attachFileBtn');
	const fileInput = document.getElementById('fileInput');
	const fileChipsEl = document.getElementById('fileChips');
	let attachedFiles = [];
	let messageQueue = [];
	const queueContainer = document.getElementById('queueContainer');
	let queueIdCounter = 0;
	let responsesToSkip = 0;
	let consecutiveErrors = 0;
	let streamingMsgDiv = null;
	let streamingText = '';
	let sessionTotalCost = 0;
	let thinkingModelName = '';

	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	function svgIcon(name, size) {
		if (typeof window.SVGIcons !== 'undefined' && window.SVGIcons[name]) {
			return window.SVGIcons[name](size);
		}
		return '';
	}

	function formatCost(cost) {
		if (cost === null || cost === undefined || cost === 0) return null;
		if (cost < 0.001) return '< $0.001';
		return '$' + cost.toFixed(4);
	}

	function persistTotalCost() {
		try { localStorage.setItem(STORAGE_KEY_TOTAL_COST, String(sessionTotalCost)); } catch (_e) {}
	}

	function addCostToMessage(msgDiv, costUsd, usage) {
		if (!costUsd && !usage) return;
		var footer = document.createElement('div');
		footer.className = 'message-cost-footer';
		var parts = [];
		if (usage) parts.push(usage.inputTokens + ' in / ' + usage.outputTokens + ' out');
		var costStr = formatCost(costUsd);
		if (costStr) parts.push(costStr);
		footer.textContent = parts.join(' \u2022 ');
		msgDiv.appendChild(footer);
	}

	function updateSessionCostDisplay() {
		var existing = document.getElementById('sessionCostTotal');
		if (sessionTotalCost <= 0) {
			if (existing) existing.remove();
			return;
		}
		if (!existing) {
			existing = document.createElement('div');
			existing.id = 'sessionCostTotal';
			existing.className = 'session-cost-total';
			messagesEl.parentElement.appendChild(existing);
		}
		var label = formatCost(sessionTotalCost) || '< $0.001';
		existing.textContent = 'Session total: ' + label;
	}

	function addMessage(type, label, content, files, modelName, skipPersist, costInfo) {
		if (emptyState) {
			emptyState.style.display = 'none';
		}

		if (!skipPersist) {
			savedMessages.push({ type: type, label: label, content: content, files: files || null, modelName: modelName || null, costUsd: costInfo ? costInfo.costUsd : null, usage: costInfo ? costInfo.usage : null });
			persistMessages();
		}

		const msgDiv = document.createElement('div');
		msgDiv.className = 'message message-' + type;

		const labelDiv = document.createElement('div');
		labelDiv.className = 'message-label';
		labelDiv.innerHTML = label;
		msgDiv.appendChild(labelDiv);

		if (modelName) {
			const modelLabel = document.createElement('div');
			modelLabel.className = 'message-model-label';
			modelLabel.textContent = modelName;
			msgDiv.appendChild(modelLabel);
		}

		const contentDiv = document.createElement('div');
		const isAiMessage = type === 'ai';
		if (isAiMessage && typeof window.renderMarkdown === 'function') {
			contentDiv.className = 'markdown-content';
			contentDiv.innerHTML = window.renderMarkdown(content);
		} else {
			contentDiv.innerHTML = escapeHtml(content);
		}
		msgDiv.appendChild(contentDiv);

		if (files && files.length > 0) {
			const attachmentsDiv = document.createElement('div');
			attachmentsDiv.className = 'message-attachments';
			for (let i = 0; i < files.length; i++) {
				const chip = document.createElement('span');
				chip.className = 'message-attachment-chip';
				chip.innerHTML = svgIcon('paperclip', '12') + ' ' + escapeHtml(files[i].name);
				attachmentsDiv.appendChild(chip);
			}
			msgDiv.appendChild(attachmentsDiv);
		}

		if (isAiMessage && costInfo) {
			addCostToMessage(msgDiv, costInfo.costUsd, costInfo.usage);
		}

		messagesEl.appendChild(msgDiv);
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	var THINKING_FILLERS = [
		'is thinking...',
		'is analyzing your request...',
		'is processing information...',
		'is reviewing your notes...',
		'is preparing a response...',
		'is crafting an answer...',
	];
	var thinkingFillerIndex = 0;
	var thinkingFillerTimer = null;

	function thinkingLabel(text) {
		return thinkingModelName ? thinkingModelName + ' ' + text : 'AI ' + text;
	}

	function startThinkingFillers() {
		thinkingFillerIndex = 0;
		if (thinkingFillerTimer) clearInterval(thinkingFillerTimer);
		thinkingFillerTimer = setInterval(function () {
			thinkingFillerIndex = (thinkingFillerIndex + 1) % THINKING_FILLERS.length;
			var el = document.getElementById('loadingIndicator');
			if (el) {
				var textNode = el.querySelector('.loading-text');
				if (textNode) textNode.textContent = thinkingLabel(THINKING_FILLERS[thinkingFillerIndex]);
			}
		}, 2000);
	}

	function stopThinkingFillers() {
		if (thinkingFillerTimer) {
			clearInterval(thinkingFillerTimer);
			thinkingFillerTimer = null;
		}
	}

	function updateThinkingStep(label) {
		var el = document.getElementById('loadingIndicator');
		if (!el) return;
		stopThinkingFillers();
		var textNode = el.querySelector('.loading-text');
		if (textNode) textNode.textContent = label;
	}

	function showLoading(show) {
		isLoading = show;
		executeBtn.disabled = show;

		const existing = document.getElementById('loadingIndicator');
		if (show && !existing) {
			const loadingDiv = document.createElement('div');
			loadingDiv.id = 'loadingIndicator';
			loadingDiv.className = 'loading';
			loadingDiv.innerHTML = '<div class="spinner"></div><span class="loading-text">' + escapeHtml(thinkingLabel('is thinking...')) + '</span>';
			messagesEl.appendChild(loadingDiv);
			messagesEl.scrollTop = messagesEl.scrollHeight;
			startThinkingFillers();
		} else if (!show && existing) {
			stopThinkingFillers();
			existing.remove();
		}
	}

	const STATE_LABELS = {
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
		let existing = document.getElementById('imageProgressBar');
		if (!existing) {
			existing = document.createElement('div');
			existing.id = 'imageProgressBar';
			existing.className = 'image-progress-bar';
			messagesEl.appendChild(existing);
		}
		const label = STATE_LABELS[state] || state;
		const pct = Math.max(0, Math.min(100, progress || 0));
		existing.innerHTML =
			'<div class="image-progress-track">' +
			'<div class="image-progress-fill" style="width:' + pct + '%"></div>' +
			'</div>' +
			'<div class="image-progress-label">' + escapeHtml(label) + ' (' + pct + '%)</div>';
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	function hideImageProgress() {
		const existing = document.getElementById('imageProgressBar');
		if (existing) existing.remove();
	}

	function ensureStreamingMessage() {
		if (streamingMsgDiv) return;
		if (emptyState) emptyState.style.display = 'none';
		streamingMsgDiv = document.createElement('div');
		streamingMsgDiv.className = 'message message-ai';
		var labelDiv = document.createElement('div');
		labelDiv.className = 'message-label';
		labelDiv.textContent = 'AI';
		streamingMsgDiv.appendChild(labelDiv);
		var contentDiv = document.createElement('div');
		contentDiv.className = 'markdown-content streaming-content';
		contentDiv.id = 'streamingContent';
		streamingMsgDiv.appendChild(contentDiv);
		messagesEl.appendChild(streamingMsgDiv);
		streamingText = '';
	}

	function appendStreamChunk(text) {
		ensureStreamingMessage();
		streamingText += text;
		var contentDiv = document.getElementById('streamingContent');
		if (contentDiv && typeof window.renderMarkdown === 'function') {
			contentDiv.innerHTML = window.renderMarkdown(streamingText);
		} else if (contentDiv) {
			contentDiv.textContent = streamingText;
		}
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	function finalizeStreamingMessage(modelName, costUsd, usage) {
		if (streamingMsgDiv) {
			if (modelName) {
				var modelDiv = document.createElement('div');
				modelDiv.className = 'message-model-label';
				modelDiv.textContent = modelName;
				streamingMsgDiv.insertBefore(modelDiv, streamingMsgDiv.children[1]);
			}
			addCostToMessage(streamingMsgDiv, costUsd, usage);
			streamingMsgDiv = null;
			streamingText = '';
		}
	}

	function formatWebSearchLabel(a) {
		const provider = (a.data && a.data.searchProvider) || '';
		const model = (a.data && a.data.searchModel) || '';
		if (provider && model) return provider.charAt(0).toUpperCase() + provider.slice(1) + ' ' + model;
		if (provider) return provider.charAt(0).toUpperCase() + provider.slice(1);
		return 'Web Search';
	}

	function renderActions(actions) {
		if (!actions || actions.length === 0) return;
		for (let i = 0; i < actions.length; i++) {
			const a = actions[i];
			if (a.action === 'web_search' && a.success) {
				addMessage(
					'action-search',
					svgIcon('globe', '14') + ' Web Search \u2014 ' + formatWebSearchLabel(a),
					a.message,
				);
				continue;
			}
			const type = a.success ? 'action-success' : 'action-error';
			const iconSvg = a.success ? svgIcon('checkCircle', '14') : svgIcon('xCircle', '14');
			addMessage(type, iconSvg + ' ' + formatActionName(a.action), a.message);
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
		for (let i = 0; i < agentRoles.length; i++) {
			const opt = document.createElement('option');
			opt.value = agentRoles[i].id;
			opt.textContent = agentRoles[i].name;
			roleSelect.appendChild(opt);
		}
		if (appliedRole) {
			roleSelect.value = appliedRole.id;
		}
	}

	function updateRoleIndicator() {
		const existing = document.querySelector('.role-active-indicator');
		if (existing) existing.remove();

		if (appliedRole) {
			const indicator = document.createElement('div');
			indicator.className = 'role-active-indicator';
			indicator.innerHTML = svgIcon('masks', '12') + ' ' + escapeHtml(appliedRole.name);
			const roleBar = document.getElementById('roleBar');
			if (roleBar) {
				roleBar.appendChild(indicator);
			}
		}
	}

	function renderManageView() {
		let html =
			'<div class="manage-header">' +
			'<h3>Manage Agent Roles</h3>' +
			'<button id="closeManageView" class="btn btn-secondary btn-sm">' + svgIcon('x', '12') + ' Close</button>' +
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
			for (let i = 0; i < agentRoles.length; i++) {
				const role = agentRoles[i];
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
			const nameInput = document.getElementById('roleNameInput');
			const promptTextarea = document.getElementById('rolePromptInput');
			const name = nameInput.value.trim();
			const prompt = promptTextarea.value.trim();
			if (!name || !prompt) return;

			if (editingRoleId) {
				for (let i = 0; i < agentRoles.length; i++) {
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

		const editBtns = document.querySelectorAll('.edit-role-btn');
		for (let e = 0; e < editBtns.length; e++) {
			editBtns[e].addEventListener('click', function () {
				const id = this.getAttribute('data-role-id');
				for (let j = 0; j < agentRoles.length; j++) {
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

		const deleteBtns = document.querySelectorAll('.delete-role-btn');
		for (let d = 0; d < deleteBtns.length; d++) {
			deleteBtns[d].addEventListener('click', function () {
				const id = this.getAttribute('data-role-id');
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
		const radius = 12;
		const circumference = 2 * Math.PI * radius;
		const offset = circumference - (percentage / 100) * circumference;
		const color = getContextColor(percentage);
		const displayPct = Math.round(percentage);

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

	function formatCharCount(n) {
		return n > 999 ? Math.round(n / 1000) + 'k' : String(n);
	}

	function updateContextCharsChip() {
		var el = document.getElementById('contextCharsChip');
		var hasSelection = selectionLength > 0;
		var chars = hasSelection ? selectionLength : noteBodyLength;
		if (chars <= 0) {
			if (el) el.remove();
			return;
		}
		if (!el) {
			el = document.createElement('span');
			el.id = 'contextCharsChip';
			el.className = 'file-chip context-chip';
		}
		var icon = hasSelection ? svgIcon('textSelect', '11') : svgIcon('fileText', '11');
		var label = hasSelection
			? 'Selection: ' + formatCharCount(chars) + ' chars'
			: 'Note: ' + formatCharCount(chars) + ' chars';
		el.className = 'file-chip context-chip' + (hasSelection ? ' context-chip--selection' : '');
		el.innerHTML = icon + ' ' + label;
		if (!el.parentElement) {
			fileChipsEl.prepend(el);
		}
	}

	function updateSelectionIndicator(hasSelection, charCount) {
		selectionLength = hasSelection ? charCount : 0;
		updateContextCharsChip();
	}

	function renderFileChips() {
		var contextEl = document.getElementById('contextCharsChip');
		fileChipsEl.innerHTML = '';
		if (contextEl) fileChipsEl.appendChild(contextEl);
		for (let i = 0; i < attachedFiles.length; i++) {
			const chip = document.createElement('span');
			chip.className = 'file-chip';
			chip.setAttribute('data-file-index', String(i));
			const nameSpan = document.createElement('span');
			nameSpan.className = 'file-chip-name';
			nameSpan.textContent = attachedFiles[i].name;
			chip.appendChild(nameSpan);
			const removeBtn = document.createElement('button');
			removeBtn.className = 'file-chip-remove';
			removeBtn.innerHTML = svgIcon('x', '10');
			removeBtn.setAttribute('data-file-index', String(i));
			removeBtn.addEventListener('click', function () {
				const idx = parseInt(this.getAttribute('data-file-index'), 10);
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

	var maxFileSize = 10 * 1024 * 1024;

	function isPdfFile(file) {
		return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
	}

	function arrayBufferToBase64(buffer) {
		var bytes = new Uint8Array(buffer);
		var binary = '';
		for (var i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return window.btoa(binary);
	}

	function handlePdfFile(file, onDone, onError) {
		var reader = new FileReader();
		reader.onload = function () {
			try {
				var text =
					typeof window.extractPdfText === 'function'
						? window.extractPdfText(reader.result)
						: '';
				if (text) {
					onDone({
						name: file.name,
						content: text,
						mimeType: 'application/pdf',
						size: file.size,
					});
					return;
				}
				var base64 = arrayBufferToBase64(reader.result);
				onDone({
					name: file.name,
					content: '[PDF document — sent as binary to the AI model for reading]',
					mimeType: 'application/pdf',
					size: file.size,
					base64Data: base64,
				});
			} catch (_err) {
				addMessage(
					'error',
					'Error',
					'Failed to process PDF "' + escapeHtml(file.name) + '".',
				);
				onError();
			}
		};
		reader.onerror = onError;
		reader.readAsArrayBuffer(file);
	}

	function handleTextFile(file, onDone, onError) {
		const reader = new FileReader();
		reader.onload = function () {
			onDone({
				name: file.name,
				content: reader.result,
				mimeType: file.type || 'text/plain',
				size: file.size,
			});
		};
		reader.onerror = onError;
		reader.readAsText(file);
	}

	function handleFileSelection() {
		const files = fileInput.files;
		if (!files || files.length === 0) return;
		let pending = files.length;
		for (let i = 0; i < files.length; i++) {
			(function (file) {
		if (file.size > maxFileSize) {
			var limitLabel = maxFileSize >= 1024 * 1024
				? Math.round(maxFileSize / (1024 * 1024)) + ' MB'
				: Math.round(maxFileSize / 1024) + ' KB';
			addMessage('error', 'Error', 'File "' + escapeHtml(file.name) + '" exceeds ' + limitLabel + ' limit.');
			pending--;
			if (pending === 0) renderFileChips();
			return;
		}
			const onDone = function (fileObj) {
				attachedFiles.push(fileObj);
				pending--;
				if (pending === 0) renderFileChips();
			};
			const onError = function () {
				pending--;
				if (pending === 0) renderFileChips();
			};
			if (isPdfFile(file)) {
				handlePdfFile(file, onDone, onError);
			} else {
				handleTextFile(file, onDone, onError);
			}
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
		for (let i = 0; i < messageQueue.length; i++) {
			const item = messageQueue[i];
			const itemDiv = document.createElement('div');
			itemDiv.className = 'queue-item';
			itemDiv.setAttribute('data-queue-id', String(item.id));
			const posSpan = document.createElement('span');
			posSpan.className = 'queue-item-position';
			posSpan.textContent = String(i + 1);
			itemDiv.appendChild(posSpan);
			const textSpan = document.createElement('span');
			textSpan.className = 'queue-item-text';
			textSpan.textContent = item.prompt.length > 100 ? item.prompt.substring(0, 97) + '...' : item.prompt;
			itemDiv.appendChild(textSpan);
			const actionsDiv = document.createElement('div');
			actionsDiv.className = 'queue-item-actions';
			const editBtn = document.createElement('button');
			editBtn.className = 'queue-item-edit';
			editBtn.innerHTML = svgIcon('pencil', '12');
			editBtn.title = 'Edit';
			editBtn.setAttribute('data-queue-id', String(item.id));
			editBtn.addEventListener('click', (function (qId) {
				return function () { editQueueItem(qId); };
			})(item.id));
			actionsDiv.appendChild(editBtn);
			const deleteBtn = document.createElement('button');
			deleteBtn.className = 'queue-item-delete';
			deleteBtn.innerHTML = svgIcon('x', '12');
			deleteBtn.title = 'Delete';
			deleteBtn.setAttribute('data-queue-id', String(item.id));
			deleteBtn.addEventListener('click', (function (qId) {
				return function () { deleteQueueItem(qId); };
			})(item.id));
			actionsDiv.appendChild(deleteBtn);
			const forceBtn = document.createElement('button');
			forceBtn.className = 'queue-item-force';
			forceBtn.innerHTML = svgIcon('zap', '12');
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

	function addToQueue(prompt, workMode, rolePrompt, files, noteId) {
		queueIdCounter++;
		messageQueue.push({
			id: queueIdCounter,
			prompt: prompt,
			workMode: workMode,
			agentRolePrompt: rolePrompt,
			attachedFiles: files,
			noteId: noteId,
		});
		renderQueue();
	}

	function findQueueItem(queueId) {
		for (let i = 0; i < messageQueue.length; i++) {
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
		const item = findQueueItem(queueId);
		if (!item) return;
		promptInput.value = item.prompt;
		promptInput.focus();
		deleteQueueItem(queueId);
	}

	function forcePushQueueItem(queueId) {
		const item = findQueueItem(queueId);
		if (!item) return;
		deleteQueueItem(queueId);
		webviewApi.postMessage({ type: 'abortRequest' });
		showLoading(false);
		responsesToSkip++;
		dispatchExecute(item.prompt, item.workMode, item.agentRolePrompt, item.attachedFiles, item.noteId);
	}

	function processNextInQueue() {
		if (messageQueue.length === 0) return;
		if (consecutiveErrors >= 3) {
			messageQueue = [];
			renderQueue();
			addMessage('error', 'Error', 'Queue cleared after repeated failures. Please check your settings and try again.');
			return;
		}
		const next = messageQueue.shift();
		renderQueue();
		dispatchExecute(next.prompt, next.workMode, next.agentRolePrompt, next.attachedFiles, next.noteId);
	}

	function dispatchExecute(prompt, workMode, rolePrompt, files, noteId) {
		addMessage('user', 'You', prompt, files);
		showLoading(true);
		lastSentPrompt = prompt;
		const msg = {
			type: 'execute',
			prompt: prompt,
			history: chatHistory.slice(),
			workMode: workMode || currentMode,
		};
		if (noteId) {
			msg.noteId = noteId;
		}
		if (rolePrompt) {
			msg.agentRolePrompt = rolePrompt;
		}
		if (files && files.length > 0) {
			msg.attachedFiles = files.slice();
		}
		webviewApi.postMessage(msg);
	}

	function sendExecute() {
		const prompt = promptInput.value.trim();
		if (!prompt) return;
		promptInput.value = '';
		promptInput.style.height = 'auto';
		const rolePrompt = appliedRole ? appliedRole.systemPrompt : undefined;
		const files = attachedFiles.length > 0 ? attachedFiles.slice() : undefined;
		const pinnedNoteId = currentNoteId;
		if (files) clearAttachedFiles();
		if (isLoading) {
			addToQueue(prompt, currentMode, rolePrompt, files, pinnedNoteId);
			return;
		}
		dispatchExecute(prompt, currentMode, rolePrompt, files, pinnedNoteId);
	}

	const MODE_PLACEHOLDERS = {
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
			persistMode();
		});
	}

	let autocompleteDropdown = null;
	let autocompleteActive = false;
	let autocompleteFocusIndex = -1;

	function getActiveNoteQuery() {
		const text = promptInput.value;
		const cursor = promptInput.selectionStart;
		const before = text.substring(0, cursor);
		const bracketMatch = before.match(/@\[([^\]]*)$/);
		if (bracketMatch) {
			const q = bracketMatch[1];
			return q.length > 0 ? q : null;
		}
		const bareMatch = before.match(/(?:^|[\s])@(\S+)$/);
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
		autocompleteFocusIndex = -1;
	}

	function setAutocompleteFocus(index) {
		if (!autocompleteDropdown) return;
		const items = autocompleteDropdown.querySelectorAll('.note-autocomplete-item');
		if (!items.length) return;
		for (let i = 0; i < items.length; i++) {
			items[i].classList.remove('note-autocomplete-item--focused');
		}
		autocompleteFocusIndex = ((index % items.length) + items.length) % items.length;
		items[autocompleteFocusIndex].classList.add('note-autocomplete-item--focused');
		if (items[autocompleteFocusIndex].scrollIntoView) {
			items[autocompleteFocusIndex].scrollIntoView({ block: 'nearest' });
		}
	}

	function insertNoteReference(title) {
		const text = promptInput.value;
		const cursor = promptInput.selectionStart;
		const before = text.substring(0, cursor);
		const after = text.substring(cursor);
		const bracketIdx = before.lastIndexOf('@[');
		if (bracketIdx !== -1) {
			const newBefore = before.substring(0, bracketIdx) + '@[' + title + '] ';
			promptInput.value = newBefore + after;
			promptInput.selectionStart = newBefore.length;
			promptInput.selectionEnd = newBefore.length;
		} else {
			const bareMatch = before.match(/(?:^|[\s])@(\S+)$/);
			if (bareMatch) {
				const atPos = before.lastIndexOf('@' + bareMatch[1]);
				const newBefore = before.substring(0, atPos) + '@[' + title + '] ';
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
		for (let i = 0; i < notes.length; i++) {
			const item = document.createElement('div');
			item.className = 'note-autocomplete-item';
			item.textContent = notes[i].title;
			item.setAttribute('data-note-id', notes[i].id);
			item.setAttribute('data-note-title', notes[i].title);
			item.addEventListener('click', function () {
				insertNoteReference(this.getAttribute('data-note-title'));
			});
			autocompleteDropdown.appendChild(item);
		}
		const inputArea = promptInput.closest('.input-area');
		if (inputArea) {
			inputArea.appendChild(autocompleteDropdown);
		} else {
			document.body.appendChild(autocompleteDropdown);
		}
		autocompleteActive = true;
		setAutocompleteFocus(0);
	}

	promptInput.addEventListener('input', function () {
		this.style.height = 'auto';
		this.style.height = Math.min(this.scrollHeight, 150) + 'px';
		const query = getActiveNoteQuery();
		if (query) {
			webviewApi.postMessage({ type: 'searchNotes', query: query });
		} else {
			removeAutocompleteDropdown();
		}
	});

	function buildSelectHtml(id, label, options, selectedValue) {
		var html = '<label class="settings-label" for="' + id + '">' + escapeHtml(label) + '</label>';
		html += '<select id="' + id + '" class="settings-select">';
		var keys = Object.keys(options);
		for (var i = 0; i < keys.length; i++) {
			var sel = keys[i] === selectedValue ? ' selected' : '';
			html += '<option value="' + escapeHtml(keys[i]) + '"' + sel + '>' + escapeHtml(options[keys[i]]) + '</option>';
		}
		html += '</select>';
		return '<div class="settings-field">' + html + '</div>';
	}

	function buildKeyInputHtml(id, label, isSet, placeholder) {
		var html = '<label class="settings-label" for="' + id + '">' + escapeHtml(label) + '</label>';
		var ph = isSet ? '\u2022\u2022\u2022\u2022 configured — leave blank to keep' : (placeholder || 'Enter API key...');
		html += '<input id="' + id + '" type="password" class="settings-input" placeholder="' + escapeHtml(ph) + '" value="" />';
		return '<div class="settings-field">' + html + '</div>';
	}

	function renderSettingsView(data) {
		lastSettingsData = data;
		var html =
			'<div class="manage-header">' +
			'<h3>AI Settings</h3>' +
			'<button id="closeSettingsView" class="btn btn-secondary btn-sm">' + svgIcon('x', '12') + ' Close</button>' +
			'</div>';

		html += '<div class="settings-form">';
		html += buildSelectHtml('settingsProvider', 'AI Provider', data.providerOptions || {}, data.provider);
		html += '<div id="settingsProviderSection">';
		html += buildKeyInputHtml('settingsOpenaiKey', 'OpenAI API Key', data.openaiKeySet, 'sk-...');
		html += buildSelectHtml('settingsOpenaiModel', 'OpenAI Model', data.openaiModelOptions || {}, data.openaiModel);
		html += buildKeyInputHtml('settingsClaudeKey', 'Claude API Key', data.claudeKeySet, 'sk-ant-...');
		html += buildSelectHtml('settingsClaudeModel', 'Claude Model', data.claudeModelOptions || {}, data.claudeModel);
		html += buildKeyInputHtml('settingsPerplexityKey', 'Perplexity API Key', data.perplexityKeySet, 'pplx-...');
		html += buildSelectHtml('settingsPerplexityModel', 'Perplexity Model', data.perplexityModelOptions || {}, data.perplexityModel);
		html += '</div>';
		html += '<div class="settings-divider"></div>';
		html += '<div class="settings-field">';
		html += '<label class="settings-label settings-checkbox-label"><input id="settingsWebSearch" type="checkbox"' + (data.webSearchEnabled ? ' checked' : '') + ' /> Enable Web Search</label>';
		html += '</div>';
		html += buildSelectHtml('settingsWebSearchModel', 'Web Search Model', data.webSearchModelOptions || {}, data.webSearchModel);
		html += '<div class="settings-divider"></div>';
		html += buildKeyInputHtml('settingsKieKey', 'Kie.ai API Key', data.kieKeySet, 'Enter Kie.ai key...');
		html += buildSelectHtml('settingsImageGenModel', 'Image Generation Model', data.imageGenModelOptions || {}, data.imageGenModel);
		html += '<div class="settings-divider"></div>';
		html += '<div class="settings-field">';
		html += '<label class="settings-label" for="settingsFileMaxSize">Max File Attachment Size (MB)</label>';
		html += '<input id="settingsFileMaxSize" type="number" class="settings-input" min="1" max="100" value="' + (data.fileMaxSizeMb || 10) + '" />';
		html += '</div>';
		html += '<button id="saveSettingsBtn" class="btn btn-primary">Save Settings</button>';
		html += '</div>';

		settingsManageView.innerHTML = html;
		updateProviderVisibility(data.provider);

		document.getElementById('closeSettingsView').addEventListener('click', function () {
			settingsManageView.style.display = 'none';
		});

		document.getElementById('settingsProvider').addEventListener('change', function () {
			updateProviderVisibility(this.value);
		});

		document.getElementById('saveSettingsBtn').addEventListener('click', function () {
			var settings = {};
			var provider = document.getElementById('settingsProvider').value;
			settings.aiProvider = provider;
			var openaiKey = document.getElementById('settingsOpenaiKey').value.trim();
			if (openaiKey) settings.openaiApiKey = openaiKey;
			settings.openaiModel = document.getElementById('settingsOpenaiModel').value;
			var claudeKey = document.getElementById('settingsClaudeKey').value.trim();
			if (claudeKey) settings.claudeApiKey = claudeKey;
			settings.claudeModel = document.getElementById('settingsClaudeModel').value;
			var perplexityKey = document.getElementById('settingsPerplexityKey').value.trim();
			if (perplexityKey) settings.perplexityApiKey = perplexityKey;
			settings.perplexityModel = document.getElementById('settingsPerplexityModel').value;
			settings.webSearchEnabled = document.getElementById('settingsWebSearch').checked;
			settings.webSearchModel = document.getElementById('settingsWebSearchModel').value;
			var kieKey = document.getElementById('settingsKieKey').value.trim();
			if (kieKey) settings.kieApiKey = kieKey;
			settings.imageGenModel = document.getElementById('settingsImageGenModel').value;
			var maxSize = parseInt(document.getElementById('settingsFileMaxSize').value, 10);
			if (maxSize > 0) settings.fileMaxSizeMb = maxSize;
			webviewApi.postMessage({ type: 'saveSettings', settings: settings });
			settingsManageView.style.display = 'none';
		});
	}

	function updateProviderVisibility(provider) {
		var fields = [
			{ prefix: 'OpenaiKey', providers: ['openai'] },
			{ prefix: 'OpenaiModel', providers: ['openai'] },
			{ prefix: 'ClaudeKey', providers: ['claude'] },
			{ prefix: 'ClaudeModel', providers: ['claude'] },
			{ prefix: 'PerplexityKey', providers: ['perplexity'] },
			{ prefix: 'PerplexityModel', providers: ['perplexity'] },
		];
		for (var i = 0; i < fields.length; i++) {
			var el = document.getElementById('settings' + fields[i].prefix);
			if (el && el.parentElement) {
				el.parentElement.style.display = fields[i].providers.indexOf(provider) !== -1 ? '' : 'none';
			}
		}
	}

	if (settingsBtn) {
		settingsBtn.addEventListener('click', function () {
			settingsPendingOpen = true;
			webviewApi.postMessage({ type: 'getSettings' });
		});
	}

	applyRoleBtn.addEventListener('click', function () {
		const selectedId = roleSelect.value;
		if (!selectedId) {
			appliedRole = null;
		} else {
			for (let i = 0; i < agentRoles.length; i++) {
				if (agentRoles[i].id === selectedId) {
					appliedRole = agentRoles[i];
					break;
				}
			}
		}
		updateRoleIndicator();
		persistAppliedRole();
	});

	manageRolesBtn.addEventListener('click', function () {
		roleManageView.style.display = '';
		renderManageView();
	});

	executeBtn.addEventListener('click', function () {
		sendExecute();
	});

	promptInput.addEventListener('keydown', function (e) {
		if (autocompleteActive) {
			if (e.key === 'Escape') {
				removeAutocompleteDropdown();
				e.preventDefault();
				return;
			}
			if (e.key === 'ArrowDown') {
				setAutocompleteFocus(autocompleteFocusIndex + 1);
				e.preventDefault();
				return;
			}
			if (e.key === 'ArrowUp') {
				setAutocompleteFocus(autocompleteFocusIndex - 1);
				e.preventDefault();
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				if (autocompleteDropdown && autocompleteFocusIndex >= 0) {
					const focused = autocompleteDropdown.querySelectorAll('.note-autocomplete-item')[autocompleteFocusIndex];
					if (focused) {
						insertNoteReference(focused.getAttribute('data-note-title'));
						return;
					}
				}
				removeAutocompleteDropdown();
				return;
			}
		}
		if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
			e.stopPropagation();
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
			e.stopPropagation();
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
		savedMessages = [];
		lastSentPrompt = null;
		messageQueue = [];
		sessionTotalCost = 0;
		renderQueue();
		clearPersistedHistory();
		try { localStorage.removeItem(STORAGE_KEY_TOTAL_COST); } catch (_e) {}
		updateSessionCostDisplay();
		if (emptyState) {
			messagesEl.appendChild(emptyState);
			emptyState.style.display = '';
		}
	});

	webviewApi.onMessage(function (event) {
		const message = event && event.message && event.message.type ? event.message : event;
		if (!message) return;

		if (message.type === 'noteInfo') {
			currentNoteId = message.noteId || null;
			noteBodyLength = message.bodyLength || 0;
			if (message.title) {
				noteInfoEl.innerHTML = svgIcon('fileText', '12') + ' ' + escapeHtml(message.title);
			} else {
				noteInfoEl.textContent = 'No note selected';
			}
			updateContextCharsChip();
		}

		if (message.type === 'selectionInfo') {
			updateSelectionIndicator(message.hasSelection, message.length);
		}

		if (message.type === 'triggerAskAI') {
			if (message.text && message.text.trim()) {
				promptInput.focus();
				if (!promptInput.value.trim()) {
					promptInput.value = '';
				}
				promptInput.setSelectionRange(promptInput.value.length, promptInput.value.length);
				updateSelectionIndicator(true, message.text.trim().length);
			}
		}

		if (message.type === 'agentRoles') {
			agentRoles = message.roles || [];
			populateRoleSelect();
			if (roleManageView.style.display !== 'none') {
				renderManageView();
			}
		}

		if (message.type === 'thinkingModel') {
			thinkingModelName = message.modelName || '';
			var loadEl = document.getElementById('loadingIndicator');
			if (loadEl) {
				var txt = loadEl.querySelector('.loading-text');
				if (txt) txt.textContent = thinkingLabel('is thinking...');
			}
		}

		if (message.type === 'imageProgress') {
			showImageProgress(message.progress, message.state);
		}

		if (message.type === 'streamChunk') {
			appendStreamChunk(message.text);
			return;
		}

		if (message.type === 'result') {
			if (responsesToSkip > 0) {
				responsesToSkip--;
				showLoading(false);
				hideImageProgress();
				streamingMsgDiv = null;
				streamingText = '';
				return;
			}
			consecutiveErrors = 0;
			showLoading(false);
			hideImageProgress();
			renderActions(message.actions);

			const hasActions = message.actions && message.actions.length > 0;
			if (message.isEdit && !hasActions) {
				addMessage(
					'edit',
					svgIcon('checkCircle', '14') + ' Note Updated',
					'The note has been updated with the AI response.',
				);
			}
			var msgCostUsd = message.costUsd || null;
			var msgUsage = message.usage || null;
			if (typeof msgCostUsd === 'number' && msgCostUsd > 0) {
				sessionTotalCost += msgCostUsd;
				persistTotalCost();
			}
			if (streamingMsgDiv && streamingText) {
				finalizeStreamingMessage(message.modelName, msgCostUsd, msgUsage);
				savedMessages.push({ type: 'ai', label: 'AI', content: message.content || streamingText, files: null, modelName: message.modelName || null, costUsd: msgCostUsd, usage: msgUsage });
				persistMessages();
			} else if (message.content) {
				addMessage('ai', 'AI', message.content, null, message.modelName, false, { costUsd: msgCostUsd, usage: msgUsage });
			}
			updateSessionCostDisplay();
			if (lastSentPrompt && (message.content || hasActions)) {
				let assistantContent = '';
				if (hasActions) {
					const actionSummaries = message.actions.map(function (a) {
						const status = a.success ? 'success' : 'failed';
						let summary = '[' + a.action + ': ' + status + '] ' + a.message;
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
					let start = chatHistory.length - MAX_HISTORY_MESSAGES;
					if (start % 2 !== 0) start++;
					chatHistory = chatHistory.slice(start);
				}
				persistHistory();
			}
			lastSentPrompt = null;
			processNextInQueue();
		}

		if (message.type === 'alert') {
			if (responsesToSkip > 0) {
				responsesToSkip--;
				showLoading(false);
				hideImageProgress();
				return;
			}
			showLoading(false);
			hideImageProgress();
			addMessage('alert', 'AI', message.message);
			lastSentPrompt = null;
			processNextInQueue();
		}

		if (message.type === 'error') {
			if (responsesToSkip > 0) {
				responsesToSkip--;
				showLoading(false);
				hideImageProgress();
				return;
			}
			consecutiveErrors++;
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

		if (message.type === 'fileSizeLimit') {
			if (message.limitBytes > 0) {
				maxFileSize = message.limitBytes;
			}
		}

		if (message.type === 'settingsData') {
			if (settingsPendingOpen) {
				settingsPendingOpen = false;
				renderSettingsView(message);
				settingsManageView.style.display = '';
			} else if (settingsManageView && settingsManageView.style.display !== 'none') {
				renderSettingsView(message);
			}
		}

		if (message.type === 'loading') {
			showLoading(message.status);
		}

		if (message.type === 'thinkingStep') {
			updateThinkingStep(message.label);
		}
	});

	function restoreFromStorage() {
		try {
			const storedMode = localStorage.getItem(STORAGE_KEY_MODE);
			if (storedMode && modeSelect) {
				modeSelect.value = storedMode;
				currentMode = storedMode;
				updateModePlaceholder();
			}
		} catch (_e) {}

		try {
			const storedRole = localStorage.getItem(STORAGE_KEY_ROLE);
			if (storedRole) {
				appliedRole = JSON.parse(storedRole);
				updateRoleIndicator();
			}
		} catch (_e) {}

		try {
			const storedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
			if (storedHistory) {
				chatHistory = JSON.parse(storedHistory);
			}
		} catch (_e) {}

		try {
			const storedCost = localStorage.getItem(STORAGE_KEY_TOTAL_COST);
			if (storedCost) sessionTotalCost = parseFloat(storedCost) || 0;
		} catch (_e) {}

		try {
			const storedMessages = localStorage.getItem(STORAGE_KEY_MESSAGES);
			if (storedMessages) {
				const messages = JSON.parse(storedMessages);
				for (let i = 0; i < messages.length; i++) {
					const m = messages[i];
					var ci = (m.costUsd || m.usage) ? { costUsd: m.costUsd, usage: m.usage } : undefined;
					addMessage(m.type, m.label, m.content, m.files, m.modelName, true, ci);
				}
				savedMessages = messages;
			}
		} catch (_e) {}

		updateSessionCostDisplay();
	}

	restoreFromStorage();

	webviewApi.postMessage({ type: 'getNote' });
	webviewApi.postMessage({ type: 'getAgentRoles' });
	webviewApi.postMessage({ type: 'getFileSizeLimit' });
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initPanel);
} else {
	initPanel();
}
