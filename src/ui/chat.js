import { chatWithModel } from '../api/ollama.js';

export function renderChat(container, agents) {
    const tpl = document.getElementById('tpl-chat');
    const clone = tpl.content.cloneNode(true);
    container.innerHTML = '';
    
    const agentList = clone.querySelector('#chat-agent-list');
    const inputArea = clone.querySelector('#chat-input');
    const btnSend = clone.querySelector('#btn-send-msg');
    const messagesContainer = clone.querySelector('#chat-messages');
    const currentAgentName = clone.querySelector('#current-chat-agent');
    const currentAgentModel = clone.querySelector('#current-chat-model');
    
    let currentAgent = null;
    let chatHistory = [];
    let isGenerating = false;

    // ----------------------------------------------------
    // Chat Persistence: Per-Agent and Global History
    // ----------------------------------------------------
    const getHistoryKey = (agentId) => agentId ? `ollamaclip_history_${agentId}` : 'ollamaclip_shared_workspace';

    const appendMessage = (role, text, agentName = null, agentColor = 'var(--accent-primary)', isProactive = false, taskTitle = null) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role} ${isProactive ? 'proactive' : ''}`;
        
        if (role === 'system') {
            msgDiv.innerHTML = `<p style="color:var(--text-muted); font-size:0.8rem; text-align:center; margin: 10px 0;">${text}</p>`;
        } else {
            let nameTag = '';
            if (role === 'agent' && agentName) {
                const taskTag = taskTitle ? `<span class="task-flag"><i class="ph ph-briefcase"></i> ${taskTitle}</span>` : '';
                nameTag = `<div style="display:flex; justify-content:space-between; align-items:center; font-size: 0.7rem; margin-bottom: 4px; font-weight: 600;">
                                <span style="color: ${agentColor}"><i class="ph-fill ph-robot"></i> ${agentName}</span>
                                ${taskTag}
                           </div>`;
            }

            const bgColor = role === 'user' ? 'var(--accent-primary)' : 
                           (isProactive ? 'rgba(0,0,0,0.3)' : 'var(--bg-panel)');
            const border = isProactive ? '1px dashed var(--border-light)' : '1px solid ' + (role === 'user' ? 'transparent' : 'var(--border-light)');

            msgDiv.innerHTML = `<div style="background: ${bgColor}; 
                                       padding: 12px 16px; 
                                       border-radius: 16px; 
                                       border-bottom-${role === 'user' ? 'right' : 'left'}-radius: 4px;
                                       border: ${border}">
                                    ${nameTag}
                                    ${text}
                                </div>`;
        }
        
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return msgDiv;
    };

    const loadChatHistory = (agentId) => {
        const key = getHistoryKey(agentId);
        const savedHistory = localStorage.getItem(key);
        messagesContainer.innerHTML = '';
        
        if (savedHistory) {
            chatHistory = JSON.parse(savedHistory);
            chatHistory.forEach(msg => {
                if (msg.role === 'system') {
                   // Skip system prompts in UI
                } else if (msg.role === 'assistant') {
                    const label = msg.isProactive ? `${msg.agentName} (Proactive)` : msg.agentName;
                    appendMessage('agent', msg.content, label, msg.agentColor, msg.isProactive, msg.taskTitle);
                } else {
                    appendMessage('user', msg.content);
                }
            });
        } else {
            chatHistory = [];
            appendMessage('system', agentId ? `This is your private workspace with ${currentAgent.name}.` : 'Welcome to the Global Workspace. All agents can see this.');
        }
        
        // Clear unread for this specific channel
        clearUnread(agentId);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const clearUnread = (agentId) => {
        const key = agentId || 'global';
        const unreads = JSON.parse(localStorage.getItem('ollamaclip_unreads') || '{}');
        if (unreads[key]) {
            delete unreads[key];
            localStorage.setItem('ollamaclip_unreads', JSON.stringify(unreads));
            window.dispatchEvent(new CustomEvent('ollamaclip_unread_updated'));
        }
    };

    const saveChatHistory = (agentId) => {
        const key = getHistoryKey(agentId);
        localStorage.setItem(key, JSON.stringify(chatHistory));
    };

    // Clean up existing listener if any to avoid duplicates
    if (window._onProactiveMessage) {
        window.removeEventListener('ollamaclip_new_message', window._onProactiveMessage);
    }

    // Live update listener for Heartbeat messages
    window._onProactiveMessage = (e) => {
        const { agent, message, taskId, taskTitle } = e.detail;
        
        // If we are currently viewing the Inbox AND either in Global OR the specific agent's thread
        if (!currentAgent || currentAgent.id === agent.id) {
            appendMessage('agent', message, `${agent.name} (Proactive)`, agent.color, true, taskTitle);
            clearUnread(currentAgent ? currentAgent.id : null);
        }
    };
    window.addEventListener('ollamaclip_new_message', window._onProactiveMessage);

    // Add Clear Chat button to Header
    const chatHeader = clone.querySelector('.chat-header');
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-secondary btn-sm';
    clearBtn.innerHTML = '<i class="ph ph-trash"></i> Clear Chat';
    clearBtn.style.padding = '4px 8px';
    clearBtn.style.fontSize = '0.75rem';
    clearBtn.addEventListener('click', () => {
        if (confirm("Clear this conversation history?")) {
            chatHistory = [];
            saveChatHistory(currentAgent ? currentAgent.id : null);
            loadChatHistory(currentAgent ? currentAgent.id : null);
        }
    });
    chatHeader.appendChild(clearBtn);

    // Initial Load (Global Inbox by default)
    loadChatHistory(null);
    
    // Smooth scroll to bottom on load
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Populate Agent List
    const renderAgentList = () => {
        const unreads = JSON.parse(localStorage.getItem('ollamaclip_unreads') || '{}');
        agentList.innerHTML = '';
        
        // 1. Add Global Inbox
        const globalUnread = unreads['global'] ? `<span class="unread-badge">${unreads['global']}</span>` : '';
        const globalBtn = document.createElement('button');
        globalBtn.className = `nav-item ${!currentAgent ? 'active' : ''}`;
        globalBtn.innerHTML = `
            <div style="display:flex; gap:12px; align-items:center">
                <i class="ph-fill ph-globe" style="color:var(--accent-primary)"></i>
                <div style="display:flex; flex-direction:column; align-items:flex-start">
                    <span>Global Inbox</span>
                    <span style="font-size:0.7rem; color:var(--text-muted)">Group Collaboration</span>
                </div>
            </div>
            ${globalUnread}`;
        globalBtn.addEventListener('click', () => {
            currentAgent = null;
            renderAgentList(); // re-render to update active state
            currentAgentName.textContent = "Global Inbox";
            currentAgentModel.textContent = "Multi-Agent Collaboration";
            inputArea.placeholder = "Message the whole team (use @AgentName to target)...";
            inputArea.disabled = false;
            btnSend.disabled = false;
            loadChatHistory(null);
        });
        agentList.appendChild(globalBtn);

        // 2. Individual Agents
        if (agents.length > 0) {
            agents.forEach(agent => {
                const unreadCount = unreads[agent.id] ? `<span class="unread-badge">${unreads[agent.id]}</span>` : '';
                const btn = document.createElement('button');
                btn.className = `nav-item ${currentAgent && currentAgent.id === agent.id ? 'active' : ''}`;
                btn.innerHTML = `
                    <div style="display:flex; gap:12px; align-items:center">
                        <i class="ph-fill ph-robot" style="color:${agent.color}"></i>
                        <div style="display:flex; flex-direction:column; align-items:flex-start">
                            <span>${agent.name}</span>
                            <span style="font-size:0.7rem; color:var(--text-muted)">${agent.model}</span>
                        </div>
                    </div>
                    ${unreadCount}`;
                
                btn.addEventListener('click', () => {
                    currentAgent = agent;
                    renderAgentList(); // update active state and unread
                    currentAgentName.textContent = agent.name;
                    currentAgentModel.textContent = agent.model;
                    inputArea.placeholder = `Message ${agent.name} (private)...`;
                    loadChatHistory(agent.id);
                    inputArea.disabled = false;
                    btnSend.disabled = false;
                });
                agentList.appendChild(btn);
            });
        }
    };

    // Initial List Render
    renderAgentList();

    // Re-render list on new message to update unread counts
    window.addEventListener('ollamaclip_unread_updated', renderAgentList);



    // Handle Send
    const handleSend = async () => {
        const text = inputArea.value.trim();
        if (!text || isGenerating) return; // Allow sending even if currentAgent is null (Global)

        // Extract Mentions (@Name)
        let respondingAgent = currentAgent; // Default to currently selected agent
        const mentionMatch = text.match(/@(\w+)/);
        
        if (mentionMatch) {
            const mentionedName = mentionMatch[1].toLowerCase();
            const foundAgent = agents.find(a => a.name.toLowerCase() === mentionedName);
            if (foundAgent) {
                respondingAgent = foundAgent;
            }
        }

        // If in Global Inbox and no mention, default to first agent (or just save without reply?)
        // Let's have agents[0] respond if no mention in Global
        if (!respondingAgent && agents.length > 0) {
            respondingAgent = agents[0];
        }

        if (!respondingAgent) {
            appendMessage('system', 'Please create at least one agent to start a conversation.');
            return;
        }

        // Add System prompt to contextualize the agent if it's their first time speaking in this thread
        // Or inject it dynamically before sending to API (so we don't pollute the visual UI with system prompts)
        const apiPayloadHistory = [
            { role: 'system', content: respondingAgent.systemPrompt || "You are a helpful AI assistant." },
            // Filter out internal metadata from our saved structure before sending to Ollama
            ...chatHistory.map(h => ({ role: h.role, content: h.content }))
        ];

        // User message
        appendMessage('user', text);
        chatHistory.push({ role: 'user', content: text });
        apiPayloadHistory.push({ role: 'user', content: text });
        saveChatHistory(currentAgent ? currentAgent.id : null);
        
        inputArea.value = '';
        inputArea.style.height = 'auto'; // reset height

        // Preparation for agent reply
        isGenerating = true;
        btnSend.disabled = true;
        btnSend.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
        
        const replyDiv = appendMessage('agent', '', respondingAgent.name, respondingAgent.color);
        const contentDivDom = replyDiv.querySelector('div');
        const textNode = document.createElement('span');
        contentDivDom.appendChild(textNode);
        
        let fullReply = "";

        await chatWithModel(
            respondingAgent.model,
            apiPayloadHistory,
            respondingAgent.options || {},
            (chunkText) => {
                fullReply += chunkText;
                textNode.innerText = fullReply;
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            },
            async () => {
                isGenerating = false;
                btnSend.innerHTML = '<i class="ph-fill ph-paper-plane-right"></i>';
                btnSend.disabled = false;
                
                chatHistory.push({ 
                    role: 'assistant', 
                    content: fullReply,
                    agentName: respondingAgent.name,
                    agentColor: respondingAgent.color,
                    taskTitle: taskTitle || null
                });
                saveChatHistory(currentAgent ? currentAgent.id : null);
                
                // ----------------------------------------------------
                // AUTO-COLLABORATION: Detect Mentions and Trigger Chain
                // ----------------------------------------------------
                const nextMention = fullReply.match(/@(\w+)/);
                if (nextMention) {
                    const nextName = nextMention[1].toLowerCase();
                    const nextAgent = agents.find(a => a.name.toLowerCase() === nextName);
                    
                    if (nextAgent && nextAgent.id !== respondingAgent.id) {
                        console.log(`🔗 Auto-triggering ${nextAgent.name} in 2 seconds...`);
                        setTimeout(() => {
                            // Recursively call handleSend but simulating a "mention-driven" input
                            // We don't want to re-append a user message, just trigger the next agent
                            triggerAgentReply(nextAgent);
                        }, 2500);
                    }
                }
                
                inputArea.focus();
            }
        );
    };

    const triggerAgentReply = async (agent) => {
        if (isGenerating) return;
        
        isGenerating = true;
        btnSend.disabled = true;
        
        const apiPayload = [
            { role: 'system', content: agent.systemPrompt || "" },
            ...chatHistory.map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: `[COLLABORATION] You were mentioned. Respond to the previous discussion.` }
        ];

        const replyDiv = appendMessage('agent', '', agent.name, agent.color);
        const textNode = document.createElement('span');
        replyDiv.querySelector('div').appendChild(textNode);
        
        let fullReply = "";

        await chatWithModel(agent.model, apiPayload, agent.options || {}, 
            (chunk) => {
                fullReply += chunk;
                textNode.innerText = fullReply;
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 
            () => {
                isGenerating = false;
                btnSend.disabled = false;
                chatHistory.push({ 
                    role: 'assistant', 
                    content: fullReply,
                    agentName: agent.name,
                    agentColor: agent.color
                });
                saveChatHistory(currentAgent ? currentAgent.id : null);

                // Check for another mention (Daisy chaining)
                const nextMention = fullReply.match(/@(\w+)/);
                if (nextMention) {
                    const nextAgent = agents.find(a => a.name.toLowerCase() === nextMention[1].toLowerCase());
                    if (nextAgent && nextAgent.id !== agent.id) {
                        setTimeout(() => triggerAgentReply(nextAgent), 2500);
                    }
                }
            }
        );
    };

    // Bind events
    btnSend.addEventListener('click', handleSend);
    inputArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Auto resize textarea
    inputArea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if(this.value.trim()) {
            btnSend.disabled = false;
        } else if(!isGenerating) {
            btnSend.disabled = true;
        }
    });

    container.appendChild(clone);
    
    // Initially disable if no agent selected
    if (!currentAgent) {
        inputArea.disabled = true;
        btnSend.disabled = true;
    }
}
