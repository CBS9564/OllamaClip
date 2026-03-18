import { chatWithModel } from './ollama.js';

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
        // Prepare context for Ollama
        const history = JSON.parse(localStorage.getItem('ollamaclip_shared_workspace') || '[]');
        
        const systemPrompt = `${agent.systemPrompt}
        
       CRITICAL: You are currently working autonomously on the following task: "${task.title}".
       Project: ${task.projectName}
       
       Your goal is to progress this task. You have direct control over your task lifecycle using these COMMAND TAGS:
       - [TASK_STATUS:Message describing current step] : Update your status text in the UI.
       - [TASK_COMPLETE] : Mark this task as finished and stop working.
       - [TASK_PAUSE] : Temporarily stop autonomous work on this task.
       - [TASK_TRANSFER:AgentName] : Hand over this task to another expert agent.
       
       - If you need to create or update a document in the project folder, use: [SAVE:filename.ext] Content [/SAVE].
       - If you are stuck or need user input, start your message with [QUESTION].
       - Keep your response concise.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-5).map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: `[HEARTBEAT] Current Task: ${task.title}. Continue your work.` }
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
                // --- Detect Progress & Control Tags ---
                const hasComplete = fullReply.includes('[TASK_COMPLETE]');
                const hasPause = fullReply.includes('[TASK_PAUSE]');
                const hasTransfer = fullReply.includes('[TASK_TRANSFER:');
                const hasStatus = fullReply.includes('[TASK_STATUS:');
                const hasSave = fullReply.includes('[SAVE:');
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
                } else if (!hasStatus && !hasSave && !hasTransfer) {
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
                let cleanedReply = fullReply;

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
                cleanedReply = cleanedReply.replace(statusRegex, (m, status) => `*(Updated status: ${status})*`);
                cleanedReply = cleanedReply.replace(completeRegex, "*(Task Completed)*");
                cleanedReply = cleanedReply.replace(pauseRegex, "*(Task Paused)*");
                cleanedReply = cleanedReply.replace(transferRegex, (m, name) => `*(Transferred task to: ${name})*`);
                cleanedReply = cleanedReply.replace(/\[DONE\]/g, "*(Finished)*");

                // Notify UI to display the proactive thought/action
                if (this.onProactiveMessage) {
                    this.onProactiveMessage(agent, cleanedReply);
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
