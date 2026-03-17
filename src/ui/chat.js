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
    // Shared Workspace: One global history for ALL agents
    // ----------------------------------------------------
    
    // Append a message to the UI
    const appendMessage = (role, text, agentName = null, agentColor = 'var(--accent-primary)', isProactive = false) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role} ${isProactive ? 'proactive' : ''}`;
        
        if (role === 'system') {
            msgDiv.innerHTML = `<p>${text}</p>`;
        } else {
            let nameTag = '';
            if (role === 'agent' && agentName) {
                nameTag = `<div style="font-size: 0.7rem; color: ${agentColor}; margin-bottom: 4px; font-weight: 600;"><i class="ph-fill ph-robot"></i> ${agentName}</div>`;
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
        return msgDiv; // Return element to allow updating (for streaming)
    };

    const loadSharedWorkspace = () => {
        const savedHistory = localStorage.getItem('ollamaclip_shared_workspace');
        if (savedHistory) {
            chatHistory = JSON.parse(savedHistory);
            chatHistory.forEach(msg => {
                if (msg.role === 'system') {
                   // Only show system messages if they are recent/relevant
                } else if (msg.role === 'assistant') {
                    const label = msg.isProactive ? `${msg.agentName} (Proactive)` : msg.agentName;
                    appendMessage('agent', msg.content, label, msg.agentColor, msg.isProactive);
                } else {
                    appendMessage('user', msg.content);
                }
            });
        }
    };

    // Clean up existing listener if any to avoid duplicates
    if (window._onProactiveMessage) {
        window.removeEventListener('ollamaclip_new_message', window._onProactiveMessage);
    }

    // Live update listener for Heartbeat messages
    window._onProactiveMessage = (e) => {
        const { agent, message } = e.detail;
        appendMessage('agent', message, `${agent.name} (Proactive)`, agent.color, true);
    };
    window.addEventListener('ollamaclip_new_message', window._onProactiveMessage);

    const saveSharedWorkspace = () => {
        localStorage.setItem('ollamaclip_shared_workspace', JSON.stringify(chatHistory));
    };

    // Load history once on init
    loadSharedWorkspace();
    
    // Smooth scroll to bottom on load
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Populate Agent List
    if (agents.length === 0) {
        agentList.innerHTML = '<p style="padding:16px; color:var(--text-muted); font-size:0.85rem">No agents available.</p>';
    } else {
        // Automatically select the first agent if none is active
        if (!currentAgent && agents.length > 0) {
            currentAgent = agents[0];
            if (currentAgentName) currentAgentName.textContent = currentAgent.name;
            if (currentAgentModel) currentAgentModel.textContent = currentAgent.model;
            inputArea.disabled = false;
            btnSend.disabled = false;
        }

        agents.forEach(agent => {
            const btn = document.createElement('button');
            btn.className = `nav-item ${currentAgent && currentAgent.id === agent.id ? 'active' : ''}`;
            btn.innerHTML = `<i class="ph-fill ph-robot" style="color:${agent.color}"></i> <div style="display:flex; flex-direction:column; align-items:flex-start"><span>${agent.name}</span><span style="font-size:0.7rem; color:var(--text-muted)">${agent.model}</span></div>`;
            
            btn.addEventListener('click', () => {
                // Remove active from others
                Array.from(agentList.children).forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                
                // Set current agent Context
                currentAgent = agent;
                if (currentAgentName) currentAgentName.textContent = agent.name;
                if (currentAgentModel) currentAgentModel.textContent = agent.model;
                inputArea.placeholder = `Message ${agent.name} (use @ to mention others)...`;
                
                // Enable input
                inputArea.disabled = false;
                btnSend.disabled = false;
            });
            agentList.appendChild(btn);
        });
    }



    // Handle Send
    const handleSend = async () => {
        const text = inputArea.value.trim();
        if (!text || !currentAgent || isGenerating) return;

        // Extract Mentions (@Name)
        let respondingAgent = currentAgent; // Default to currently selected agent in sidebar
        const mentionMatch = text.match(/@(\w+)/);
        
        if (mentionMatch) {
            const mentionedName = mentionMatch[1].toLowerCase();
            const foundAgent = agents.find(a => a.name.toLowerCase() === mentionedName);
            if (foundAgent) {
                respondingAgent = foundAgent;
            }
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
        saveSharedWorkspace();
        
        inputArea.value = '';
        inputArea.style.height = 'auto'; // reset height

        // Preparation for agent reply
        isGenerating = true;
        btnSend.disabled = true;
        btnSend.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
        
        const replyDiv = appendMessage('agent', '', respondingAgent.name, respondingAgent.color);
        // The text content element is the second child node of the inner div if nameTag is present.
        const contentDivDom = replyDiv.querySelector('div');
        
        // We need a safe way to append text below the name tag without overriding the name HTML
        const textNode = document.createElement('span');
        contentDivDom.appendChild(textNode);
        
        let fullReply = "";

        // Call API targeting the specific mentioned agent (or the current one)
        await chatWithModel(
            respondingAgent.model,
            apiPayloadHistory,
            respondingAgent.options || {}, // V6: Pass custom agent tuning (temp, ctx)
            (chunkText) => {
                fullReply += chunkText;
                textNode.innerText = fullReply;
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            },
            () => {
                isGenerating = false;
                btnSend.innerHTML = '<i class="ph-fill ph-paper-plane-right"></i>';
                btnSend.disabled = false;
                
                // Save the assistant reply alongside metadata about WHO replied
                chatHistory.push({ 
                    role: 'assistant', 
                    content: fullReply,
                    agentName: respondingAgent.name,
                    agentColor: respondingAgent.color
                });
                saveSharedWorkspace();
                
                // Focus input back
                inputArea.focus();
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
