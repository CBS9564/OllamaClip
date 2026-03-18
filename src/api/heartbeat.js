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
       Workspace: ${task.workspaceName} | Project: ${task.projectName}
       
       Your goal is to progress this task. 
       - If you need to create or update a document in the project folder, use this syntax: [SAVE:filename.ext] Content of the file [/SAVE].
       - If you have enough info, perform the next step and report progress.
       - If you are stuck or need clarification/missing info from the user, ASK A QUESTION directly and start your message with [QUESTION].
       - If the task is TOTALLY FINISHED, end your message with [DONE] to close the task.
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
                // Check if agent is asking a question or is done
                if (fullReply.includes('[DONE]')) {
                    this.updateTaskCompletion(task.id);
                } else if (fullReply.includes('[QUESTION]')) {
                    this.updateTaskStatus(task.id, 'needs_input');
                } else {
                    this.updateTaskStatus(task.id, 'processing');
                }

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
                            workspaceName: task.workspaceName,
                            projectName: task.projectName
                        })
                    }).catch(e => console.error("Failed to save agent file", e));
                    
                    // Optional: remove tag from UI display
                    cleanedReply = cleanedReply.replace(match[0], `*(Saved file: ${filename})*`);
                }

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

    async updateTaskStatus(taskId, status) {
        try {
            await fetch(`${API_URL}/tasks/${taskId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ status })
            });
            window.dispatchEvent(new CustomEvent('ollamaclip_tasks_updated'));
        } catch(e) { console.error("Heartbeat: API error updating status", e); }
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
