import { chatWithModel } from './ollama.js';
import { showToast } from '../ui/utils.js';

const API_URL = 'http://localhost:3001/api';

/**
 * HeartbeatManager
 * Handles autonomous agent task progression and proactive questioning.
 */
export class HeartbeatManager {
    constructor(getAgents, onProactiveMessage) {
        this.getAgents = getAgents;
        this.onProactiveMessage = onProactiveMessage; // Callback to UI (chat)
        this.intervalId = null;
        this.tickRate = 30000; // 30 seconds default
        this.isProcessing = false;
    }

    start() {
        if (this.intervalId) return;
        this.intervalId = setInterval(() => this.tick(), this.tickRate);
        console.log("💓 Heartbeat started at 30s interval.");
    }

    stop() {
        clearInterval(this.intervalId);
        this.intervalId = null;
    }

    async tick() {
        if (this.isProcessing) return;
        
        // Load tasks from API
        let tasks = [];
        try {
            const res = await fetch(`${API_URL}/tasks`);
            if (res.ok) tasks = await res.json();
        } catch(e) {
            console.error("Heartbeat: could not load tasks", e);
            this.isProcessing = false;
            return;
        }
        const activeTasks = tasks.filter(t => !t.completed && t.heartbeat && t.status !== 'needs_input');

        if (activeTasks.length === 0) return;

        this.isProcessing = true;

        for (const task of activeTasks) {
            const agent = this.getAgents().find(a => a.id === task.agentId);
            if (!agent) continue;

            console.log(`🤖 Heartbeat: Agent ${agent.name} processing task "${task.title}"`);
            
            try {
                await this.processTask(agent, task);
            } catch (error) {
                console.error(`Heartbeat error for ${agent.name}:`, error);
            }
        }

        this.isProcessing = false;
    }

    async processTask(agent, task) {
        // 1. Fetch task-specific history from database
        let history = [];
        try {
            const hRes = await fetch(`${API_URL}/chat/${task.id}`);
            if (hRes.ok) history = await hRes.json();
        } catch (e) {
            console.error("[Heartbeat] History fetch error:", e);
        }
        
        const systemPrompt = `${agent.systemPrompt}
        
### 🧠 OPERATIONAL ENVIRONMENT:
- Project: ${task.projectName}
- Global Objective: ${task.projectContext || 'No specific objective provided.'}
- **CURRENT TASK**: "${task.title}"
- **TASK DETAILS**: ${task.context || 'Follow general project objectives.'}

### 🛠️ COMMAND TOOLS (MANDATORY):
To continue your autonomous loop, you **MUST** include exactly one of these tags in your response. If you don't, your "Heartbeat" will stop.

1. \`[TASK_STATUS: Message]\` : Use this to report what you are doing right now (e.g., "[TASK_STATUS: Researching API documentation]").
2. \`[TASK_COMPLETE]\` : Use ONLY when the entire task objective is met.
3. \`[TASK_EDIT: New Title | New Context]\` : Use to refine your task as you progress.
4. \`[TASK_CREATE: Title | AgentName]\` : Create a sub-task for another agent.
5. \`[SAVE: filename.ext] Content [/SAVE]\` : Persist code or notes to the workspace.
6. \`[QUESTION]\` : Use if you are genuinely stuck and need the USER's help.

### 📝 RESPONSE FORMAT EXAMPLE:
"I have analyzed the requirements. I will now start the implementation.
[TASK_STATUS: Starting implementation of the login logic]
[SAVE: login.js] 
// implementation here...
[/SAVE]"

### ⚠️ CRITICAL RULE:
Focus on progression. Be concise. If you provide a generic response without a \`[TAG]\`, you will be deactivated.🎉🏛️🔐`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: `[SYSTEM HEARTBEAT]
Current Task: "${task.title}"
Action Required: Progress this task now. 
IMPORTANT: Your response MUST contain a COMMAND TAG like [TASK_STATUS: ...] or [TASK_COMPLETE] to trigger the next step. If you do not use a tag, your process will be TERMINATED.` }
        ];

        let fullReply = "";
        
        await chatWithModel(
            agent.model,
            messages,
            agent.options || {},
            (chunk) => {
                fullReply += chunk;
                // We could stream this to UI if we want, but for heartbeat 
                // we'll wait for completion or send it via callback
            },
            () => {
                // --- Initialize reply processing ---
                let cleanedReply = fullReply;
                
                // --- Detect Progress & Control Tags ---
                const hasComplete = /\[?(TASK_COMPLETE|MARK COMPLETED|TASK COMPLETE|FINISHED)\]?/i.test(fullReply);
                const hasPause = /\[?TASK_PAUSE\]?/i.test(fullReply);
                const hasTransfer = /\[?TASK_TRANSFER[:\s]/i.test(fullReply);
                const hasStatus = /\[?(TASK_STATUS|STATUS|PROGRESS)[:\s]/i.test(fullReply);
                const hasEdit = /\[?(TASK_EDIT|RENAME TASK|TASK_RENAME)[:\s]/i.test(fullReply);
                const hasSave = fullReply.includes('[SAVE:') || fullReply.includes('SAVE:');
                const hasCreate = /\[?TASK_CREATE[:\s]/i.test(fullReply);
                const hasQuestion = fullReply.includes('QUESTION') || fullReply.includes('[QUESTION]');
                const hasWaiting = fullReply.includes('WAITING');

                let finalStatus = 'processing';
                let finalHeartbeat = task.heartbeat;

                if (hasComplete) {
                    finalStatus = 'completed';
                    finalHeartbeat = 0;
                } else if (hasPause) {
                    finalStatus = 'paused';
                    finalHeartbeat = 0;
                } else if (hasQuestion || hasWaiting) {
                    finalStatus = 'needs_input';
                    finalHeartbeat = 1; // Keep heartbeat on, but it will be filtered out by tick() due to status
                } else if (!hasStatus && !hasSave && !hasTransfer && !hasEdit && !hasCreate && !hasComplete) {
                    // AUTO-PAUSE: If no specific action tags were used, assume task is idling/waiting for feedback
                    console.log(`[Heartbeat] Agent ${agent.name} provided no progress tags. Auto-pausing heartbeat.`);
                    finalStatus = 'awaiting feedback';
                    finalHeartbeat = 0;
                    cleanedReply += "\n\n*(Auto-paused heartbeat: No specific progress tags detected)*";
                }

                this.updateTask(task.id, { 
                    status: finalStatus, 
                    heartbeat: finalHeartbeat,
                    completed: hasComplete ? 1 : 0 
                });

                // --- Parse and Sync Files ---
                const saveRegex = /\[SAVE:([^\]]+)\]([\s\S]*?)\[\/SAVE\]/img;
                let match;
                // cleanedReply already initialized above

                while ((match = saveRegex.exec(fullReply)) !== null) {
                    const filename = match[1].trim();
                    const content = match[2].trim();
                    
                    console.log(`[Heartbeat] Agent ${agent.name} saving file: ${filename}`);
                    
                    fetch(`${API_URL}/workspace/file`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            filename,
                            content,
                            projectName: task.projectName
                        })
                    }).catch(e => console.error("Failed to save agent file", e));
                    
                    // Optional: remove tag from UI display
                    cleanedReply = cleanedReply.replace(match[0], `*(Saved file: ${filename})*`);
                }

                // 2. Task Control Tags (Already handled by the new logic above, but we still want to clean the UI text)
                const statusRegex = /\[TASK_STATUS:(.*?)\]/g;
                const completeRegex = /\[TASK_COMPLETE\]/g;
                const pauseRegex = /\[TASK_PAUSE\]/g;
                const transferRegex = /\[TASK_TRANSFER:(.*?)\]/g;

                // Cleanup tags from the cleanedReply for UI display
                cleanedReply = cleanedReply.replace(/\[?(TASK_STATUS|STATUS|PROGRESS)[:\s]\s*(.*?)\]?/gi, (m, statusLabel, statusText) => `*(Updated status: ${statusText})*`);
                cleanedReply = cleanedReply.replace(/\[?(TASK_COMPLETE|MARK COMPLETED|TASK COMPLETE|FINISHED)\]?/gi, "*(Task Completed)*");
                cleanedReply = cleanedReply.replace(/\[?TASK_PAUSE\]?/gi, "*(Task Paused)*");
                cleanedReply = cleanedReply.replace(/\[?TASK_TRANSFER[:\s]\s*(.*?)\]?/gi, (m, name) => `*(Transferred task to: ${name})*`);
                cleanedReply = cleanedReply.replace(/\[?TASK_CREATE[:\s]\s*([^|\]\n]+)\s*\|\s*([^\]\n]+)\s*\]?/gi, (m, title, name) => `*(Created new task: "${title.trim()}" for ${name.trim()})*`);
                cleanedReply = cleanedReply.replace(/\[DONE\]/g, "*(Finished)*");

                // --- Persistence ---
                // Save proactive message to database
                fetch(`${API_URL}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskId: task.id,
                        agentId: agent.id,
                        role: 'assistant',
                        content: cleanedReply,
                        isProactive: true
                    })
                }).catch(err => console.error("[Heartbeat] Persistence error:", err));

                // Notify UI to display the proactive thought/action
                if (this.onProactiveMessage) {
                    this.onProactiveMessage({
                        role: 'agent',
                        text: cleanedReply,
                        agentName: agent.name,
                        agentColor: agent.color || 'var(--accent-primary)',
                        isProactive: true,
                        taskTitle: task.title,
                        taskId: task.id
                    });
                }

                // --- Execute Orchestration Commands ---
                console.log(`[Orchestration] Checking for commands in reply from ${agent.name}...`);
                
                // 1. Task Transfer [TASK_TRANSFER:AgentName]
                const oTransferRegex = /\[?TASK_TRANSFER[:\s]\s*([^\]\n]+)\s*\]?/gi;
                const oTransferMatch = oTransferRegex.exec(fullReply);
                if (oTransferMatch) {
                    const targetName = oTransferMatch[1].trim();
                    console.log(`[Orchestration] Transfer match found: "${targetName}"`);
                    const targetAgent = this.getAgents().find(a => a.name.toLowerCase() === targetName.toLowerCase());
                    if (targetAgent) {
                        console.log(`[Orchestration] Transferring task ${task.id} to ${targetAgent.name} (${targetAgent.id})`);
                        this.updateTask(task.id, { agentId: targetAgent.id, status: `Transferred to ${targetAgent.name}` });
                        showToast(`Task "${task.title}" transferred to ${targetAgent.name}`, 'info');
                    } else {
                        console.warn(`[Orchestration] Could not find target agent: "${targetName}"`);
                    }
                }

                // 2. Task Creation [TASK_CREATE:Title | AgentName]
                const oCreateRegex = /\[?TASK_CREATE[:\s]\s*([^|\]\n]+)\s*\|\s*([^\]\n]+)\s*\]?/gi;
                let cMatch;
                while ((cMatch = oCreateRegex.exec(fullReply)) !== null) {
                    const title = cMatch[1].trim();
                    const targetName = cMatch[2].trim();
                    console.log(`[Orchestration] Creation match found: "${title}" for "${targetName}"`);
                    
                    const targetAgent = this.getAgents().find(a => a.name.toLowerCase() === targetName.toLowerCase());
                    
                    if (targetAgent) {
                        const newTaskId = `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                        console.log(`[Orchestration] Agent ${agent.name} creating task: "${title}" for ${targetAgent.name} (ID: ${newTaskId})`);
                        
                        fetch(`${API_URL}/tasks`, {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({
                                id: newTaskId,
                                title: title,
                                agentId: targetAgent.id,
                                projectId: task.projectId || 'default_project',
                                status: 'open',
                                completed: 0
                            })
                        }).then(() => {
                            console.log(`[Orchestration] Successfully created task: ${newTaskId}`);
                            window.dispatchEvent(new CustomEvent('ollamaclip_tasks_updated'));
                            showToast(`New task created: "${title}" for ${targetAgent.name}`, 'success');
                        }).catch(e => console.error("[Orchestration] Failed to create task", e));
                    } else {
                        console.warn(`[Orchestration] Could not find creator target agent: "${targetName}"`);
                    }
                }

                // 3. Task Status [TASK_STATUS:Message]
                const oStatusRegex = /\[?(TASK_STATUS|STATUS|PROGRESS)[:\s]\s*([^\]\n]+)\s*\]?/gi;
                const oStatusMatch = oStatusRegex.exec(fullReply);
                if (oStatusMatch) {
                    const newStatus = oStatusMatch[2].trim();
                    console.log(`[Orchestration] Updating status for task ${task.id}: "${newStatus}"`);
                    this.updateTask(task.id, { status: newStatus });
                }

                // 4. Task Completion [TASK_COMPLETE]
                if (/\[?(TASK_COMPLETE|MARK COMPLETED|TASK COMPLETE|FINISHED)\]?/i.test(fullReply)) {
                    console.log(`[Orchestration] Completing task ${task.id}`);
                    this.updateTaskCompletion(task.id);
                    showToast(`Agent ${agent.name} completed task: "${task.title}"`, 'success');
                }

                // 5. Task Edit [TASK_EDIT:Title | Context]
                const oEditRegex = /\[?(TASK_EDIT|RENAME TASK|TASK_RENAME)[:\s]\s*([^|\]\n]+)\s*\|\s*([^\]\n]+)\s*\]?/gi;
                const oEditMatch = oEditRegex.exec(fullReply);
                if (oEditMatch) {
                    const newTitle = oEditMatch[2].trim();
                    const newContext = oEditMatch[3].trim();
                    console.log(`[Orchestration] Editing task ${task.id}: "${newTitle}"`);
                    this.updateTask(task.id, { title: newTitle, context: newContext });
                    showToast(`Agent ${agent.name} redefined task: "${newTitle}"`, 'info');
                }

                // Global event for chat UI to catch and flag with task
                window.dispatchEvent(new CustomEvent('ollamaclip_new_message', {
                    detail: { 
                        agent: agent, 
                        message: cleanedReply,
                        taskId: task.id,
                        taskTitle: task.title
                    }
                }));
            }
        );
    }

    async updateTask(taskId, updates) {
        try {
            await fetch(`${API_URL}/tasks/${taskId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(updates)
            });
            window.dispatchEvent(new CustomEvent('ollamaclip_tasks_updated'));
        } catch(e) { console.error("Heartbeat: API error updating task", e); }
    }

    async updateTaskCompletion(taskId) {
        try {
            await fetch(`${API_URL}/tasks/${taskId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ completed: true, heartbeat: false, status: 'completed' })
            });
            window.dispatchEvent(new CustomEvent('ollamaclip_tasks_updated'));
        } catch(e) { console.error("Heartbeat: API error updating completion", e); }
    }
}
