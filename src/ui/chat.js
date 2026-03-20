import { chatWithModel } from '../api/ollama.js';
import { showToast, showModal, simpleMarkdown } from './utils.js';

export function renderChat(container, agents, appState) {
    const tpl = document.getElementById('tpl-chat');
    const clone = tpl.content.cloneNode(true);
    container.innerHTML = '';
    
    const sidebarList = clone.querySelector('#chat-agent-list'); // Renamed conceptually to Sidebar
    const inputArea = clone.querySelector('#chat-input');
    const btnSend = clone.querySelector('#btn-send-msg');
    const messagesContainer = clone.querySelector('#chat-messages');
    const currentChatHeader = clone.querySelector('#current-chat-agent');
    const currentChatSubHeader = clone.querySelector('#current-chat-model');
    const currentProjectFlag = clone.querySelector('#current-chat-project-flag');
    const thinkingIndicator = clone.querySelector('#chat-thinking-indicator');
    
    // Global thinking events for this view
    const onStart = () => { if (thinkingIndicator) thinkingIndicator.style.display = 'inline-block'; };
    const onStop = () => { if (thinkingIndicator) thinkingIndicator.style.display = 'none'; };
    window.addEventListener('ollama_thinking_start', onStart);
    window.addEventListener('ollama_thinking_stop', onStop);
    
    // Use persistent state if available
    let currentTaskId = appState.activeTaskId || null;
    let currentTask = appState.tasks.find(t => t.id === currentTaskId) || null;
    let chatHistory = [];
    let isGenerating = false;

    const appendMessage = (role, text, agentName = null, agentColor = 'var(--accent-primary)', isProactive = false, taskTitle = null) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role} ${isProactive ? 'proactive' : ''}`;
        
        if (role === 'system') {
            msgDiv.innerHTML = `<p style="color:var(--text-muted); font-size:0.8rem; text-align:center; margin: 10px 0;">${text}</p>`;
        } else {
            const isUser = role === 'user';
            const displayName = isUser ? 'You' : (agentName || 'Agent');
            const icon = isUser ? 'ph-fill ph-user' : 'ph-fill ph-robot';
            const color = isUser ? 'var(--accent-primary)' : agentColor;
            
            const proactiveTag = isProactive ? `<span class="proactive-tag"><i class="ph-fill ph-lightbulb"></i> Auto-Think</span>` : '';

            const header = `<div class="message-header" style="justify-content: ${isUser ? 'flex-end' : 'flex-start'}">
                                ${!isUser ? `<i class="${icon}" style="color: ${color}"></i>` : ''}
                                <span class="sender-name">${displayName}</span>
                                ${isUser ? `<i class="${icon}" style="color: ${color}"></i>` : ''}
                                ${proactiveTag}
                            </div>`;

            const parsedText = simpleMarkdown(text);

            msgDiv.innerHTML = `
                <div class="message-bubble ${isUser ? 'user' : 'agent'} ${isProactive ? 'proactive' : ''}" style="--agent-color: ${color}">
                    ${header}
                    <div class="message-text">${parsedText}</div>
                </div>`;
        }
        
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return msgDiv;
    };

    const loadChatHistory = async (taskId) => {
        messagesContainer.innerHTML = '';
        if (!taskId) return;

        try {
            const res = await fetch(`${appState.backendUrl}/chat/${taskId}`);
            if (res.ok) {
                chatHistory = await res.json();
                chatHistory.forEach(msg => {
                    const agent = agents.find(a => a.id === msg.agentId);
                    const agentName = agent ? agent.name : (msg.agentId ? 'Unknown Agent' : null);
                    const agentColor = agent ? agent.color : 'var(--accent-primary)';
                    
                    if (msg.role === 'assistant') {
                        appendMessage('agent', msg.content, agentName, agentColor, msg.isProactive);
                    } else if (msg.role === 'user') {
                        appendMessage('user', msg.content);
                    } else {
                        appendMessage('system', msg.content);
                    }
                });
            }
        } catch (error) {
            console.error("[Chat] Load error:", error);
            showToast("Failed to load chat history", "error");
        }
        
        // Clear unreads for this task
        clearUnread(taskId);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const clearUnread = (taskId) => {
        const unreads = JSON.parse(localStorage.getItem('ollamaclip_unreads_tasks') || '{}');
        if (unreads[taskId]) {
            delete unreads[taskId];
            localStorage.setItem('ollamaclip_unreads_tasks', JSON.stringify(unreads));
            window.dispatchEvent(new CustomEvent('ollamaclip_unread_updated'));
        }
    };

    const renderSidebar = () => {
        if (!sidebarList) return;
        sidebarList.innerHTML = '';
        const unreads = JSON.parse(localStorage.getItem('ollamaclip_unreads_tasks') || '{}');

        // 1. Filter tasks for current project
        const tasks = appState.tasks || [];
        const projectTasks = tasks.filter(t => String(t.projectId) === String(appState.activeProjectId));

        // Auto-select first task if none selected or if it was the removed general chat
        if (projectTasks.length > 0 && (!currentTaskId || String(currentTaskId).startsWith('project_'))) {
            const firstTask = projectTasks[0];
            currentTaskId = firstTask.id;
            appState.activeTaskId = firstTask.id;
            currentTask = firstTask;
            
            // Setup the view for this task
            const agent = agents.find(a => a.id === firstTask.agentId);
            currentChatHeader.textContent = firstTask.title;
            currentChatSubHeader.textContent = agent ? `Assigned to: ${agent.name}` : 'Unassigned';
            inputArea.placeholder = `Discussing: ${firstTask.title}...`;
            inputArea.disabled = false;
            btnSend.disabled = false;
            loadChatHistory(firstTask.id);
        }

        if (projectTasks.length === 0 && tasks.length > 0) {
            // If project is selected but has no tasks, we still show General
        }

        projectTasks.forEach(task => {
            const agent = agents.find(a => a.id === task.agentId);
            const unreadCount = unreads[task.id] ? `<span class="unread-badge">${unreads[task.id]}</span>` : '';
            
            const btn = document.createElement('button');
            btn.className = `nav-item ${currentTaskId === task.id ? 'active' : ''}`;
            btn.innerHTML = `
                <div style="display:flex; gap:12px; align-items:center; width: 100%">
                    <i class="ph-fill ph-briefcase" style="color:${agent ? agent.color : 'var(--text-muted)'}"></i>
                    <div style="display:flex; flex-direction:column; align-items:flex-start; overflow: hidden; flex: 1">
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; font-weight: 600">${task.title}</span>
                        <span style="font-size:0.65rem; color:var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%">${(task.lastMessage || (agent ? agent.name : 'No Agent Assigned')).slice(0, 35)}${(task.lastMessage?.length > 35) ? '...' : ''}</span>
                    </div>
                </div>
                ${unreadCount}`;
            
            btn.addEventListener('click', () => {
                currentTaskId = task.id;
                appState.activeTaskId = task.id; // Persist
                currentTask = task;
                renderSidebar();
                currentChatHeader.textContent = task.title;
                currentChatSubHeader.textContent = agent ? `Assigned to: ${agent.name}` : 'Unassigned';
                inputArea.placeholder = `Discussing: ${task.title}...`;
                inputArea.disabled = false;
                btnSend.disabled = false;
                loadChatHistory(task.id);
            });
            sidebarList.appendChild(btn);
        });
    };

    // Live update listener for Heartbeat messages
    const onNewMessage = (e) => {
        const { role, text, agentName, agentColor, isProactive, taskId } = e;
        
        // Update local state for sidebar preview
        if (taskId.startsWith('project_')) {
            const p = appState.projects.find(proj => String(proj.id) === String(taskId.replace('project_', '')));
            if (p) p.lastMessage = text;
        } else {
            const t = appState.tasks.find(tk => String(tk.id) === String(taskId));
            if (t) t.lastMessage = text;
        }

        // If we are currently viewing this task
        if (currentTaskId === taskId) {
            appendMessage(role, text, agentName, agentColor, isProactive);
            clearUnread(taskId);
        } else {
            // Update unreads in sidebar
            const unreads = JSON.parse(localStorage.getItem('ollamaclip_unreads_tasks') || '{}');
            unreads[taskId] = (unreads[taskId] || 0) + 1;
            localStorage.setItem('ollamaclip_unreads_tasks', JSON.stringify(unreads));
        }
        
        // Trigger sidebar re-render via standard event
        window.dispatchEvent(new CustomEvent('ollamaclip_unread_updated'));
    };

    // Expose listener for main.js to call
    window._onChatUpdate = onNewMessage;

    // Handle Send
    const handleSend = async () => {
        const text = inputArea.value.trim();
        if (!text || isGenerating || !currentTaskId) return;

        // Save User Message to DB
        try {
            const res = await fetch(`${appState.backendUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId: currentTaskId,
                    role: 'user',
                    content: text
                })
            });
            if (!res.ok) throw new Error("Save error");
        } catch (e) {
            console.error("Failed to save user message", e);
        }

        appendMessage('user', text);
        inputArea.value = '';
        inputArea.style.height = 'auto';

        // Update local state for sidebar preview
        if (currentTaskId.startsWith('project_')) {
            const p = appState.projects.find(proj => String(proj.id) === String(appState.activeProjectId));
            if (p) p.lastMessage = text;
        } else {
            const t = appState.tasks.find(tk => String(tk.id) === String(currentTaskId));
            if (t) t.lastMessage = text;
        }
        
        // Trigger sidebar re-render
        window.dispatchEvent(new CustomEvent('ollamaclip_unread_updated'));

        // Trigger Agent Response
        // 1. @Mention Handling (Overrides assigned agent)
        let targetAgent = null;
        const mentionMatch = text.match(/^@(\w+)/);
        if (mentionMatch) {
            const agentName = mentionMatch[1].toLowerCase();
            targetAgent = agents.find(a => 
                a.name.toLowerCase() === agentName && 
                String(a.projectId) === String(appState.activeProjectId)
            );
        }

        // 2. Fallback to assigned agent
        if (!targetAgent) {
            targetAgent = agents.find(a => a.id === currentTask.agentId);
        }

        if (!targetAgent) {
            if (currentTaskId.startsWith('project_')) {
                appendMessage('system', 'In General Chat, use @AgentName (e.g., @CEO) to talk to a specific agent.');
            } else {
                appendMessage('system', 'No agent assigned to this task. Assign an agent or use @AgentName.');
            }
            return;
        }

        isGenerating = true;
        btnSend.disabled = true;
        btnSend.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
        window.dispatchEvent(new CustomEvent('agent_thinking_start', { detail: { agentId: targetAgent.id } }));

        const replyDiv = appendMessage('agent', '', targetAgent.name, targetAgent.color);
        const textNode = document.createElement('span');
        replyDiv.querySelector('.message-text').appendChild(textNode);
        
        let fullReply = "";

        // Prepare context
        const historyRes = await fetch(`${appState.backendUrl}/chat/${currentTaskId}`);
        const history = await historyRes.json();
        
        // Strip mention from the text sent to model
        const queryText = mentionMatch ? text.replace(/^@\w+\s*/, '') : text;

        const messages = [
            { role: 'system', content: `${targetAgent.systemPrompt}\n\nProject: ${currentTask.projectName}\nTask: ${currentTask.title}\nContext: ${currentTask.context}` },
            ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: queryText }
        ];

        await chatWithModel(
            targetAgent.model,
            messages,
            targetAgent.options || {},
            (chunk) => {
                fullReply += chunk;
                textNode.innerText = fullReply;
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            },
            async () => {
                isGenerating = false;
                btnSend.innerHTML = '<i class="ph-fill ph-paper-plane-right"></i>';
                btnSend.disabled = false;
                window.dispatchEvent(new CustomEvent('agent_thinking_stop', { detail: { agentId: targetAgent.id } }));
                
                // Save AI Reply to DB
                fetch(`${appState.backendUrl}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskId: currentTaskId,
                        agentId: targetAgent.id,
                        role: 'assistant',
                        content: fullReply
                    })
                });
                
                inputArea.focus();
            }
        );
    };

    // Clear Chat Logic
    const clearBtn = clone.querySelector('#btn-clear-chat');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!currentTaskId) {
                showToast("Select a conversation first.", "warning");
                return;
            }
            
            showModal(
                "Clear Task History?",
                `Delete all messages for this conversation?`,
                async () => {
                    try {
                        await fetch(`${appState.backendUrl}/chat/task/${currentTaskId}`, { method: 'DELETE' });
                        messagesContainer.innerHTML = '';

                        // Update local state to clear preview
                        if (currentTaskId.startsWith('project_')) {
                            const p = appState.projects.find(proj => proj.id === appState.activeProjectId);
                            if (p) p.lastMessage = null;
                        } else {
                            const t = appState.tasks.find(tk => tk.id === currentTaskId);
                            if (t) t.lastMessage = null;
                        }
                        
                        renderSidebar();
                        showToast("Chat history cleared.", "success");
                    } catch (err) {
                        console.error("[Chat] Clear history error:", err);
                    }
                }
            );
        });
    }

    // Live update listener for sidebar (tasks changed/deleted)
    const onTasksUpdated = () => {
        console.log(`[Chat] Tasks updated, refreshing sidebar...`);
        renderSidebar();
    };
    window.addEventListener('ollamaclip_tasks_updated', onTasksUpdated);

    // Attach events
    btnSend.addEventListener('click', handleSend);
    inputArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    inputArea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        btnSend.disabled = !this.value.trim() && !isGenerating;
    });

    window.addEventListener('ollamaclip_unread_updated', renderSidebar);

    // Initial Load if state exists
    if (currentTaskId) {
        if (typeof currentTaskId === 'string' && currentTaskId.startsWith('project_')) {
            currentChatHeader.textContent = "General Project Chat";
            currentChatSubHeader.textContent = appState.activeProjectName;
            inputArea.placeholder = "Message the team (use @AgentName to target)...";
            inputArea.disabled = false;
            btnSend.disabled = false;
        } else if (currentTask) {
            currentChatHeader.textContent = currentTask.title;
            const ag = agents.find(a => a.id === currentTask.agentId);
            currentChatSubHeader.textContent = ag ? `Assigned to: ${ag.name}` : 'Unassigned';
            inputArea.placeholder = `Discussing: ${currentTask.title}...`;
            inputArea.disabled = false;
            btnSend.disabled = false;
        }
        loadChatHistory(currentTaskId);
    }

    renderSidebar();
    container.appendChild(clone);
}
