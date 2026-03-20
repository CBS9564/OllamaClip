import { chatWithModel } from './ollama.js';
import { getOrchestrationDecision, executeToolAction } from './orchestrator.js';
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
        this.runningTasks = new Set(); // Task Tail: prevent concurrent work on same task
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
        try {
            const promises = activeTasks.map(async (task) => {
                if (this.runningTasks.has(task.id)) return;

                const agent = this.getAgents().find(a => a.id === task.agentId);
                if (!agent) return;

                console.log(`🤖 Heartbeat: Agent ${agent.name} processing task "${task.title}"`);
                
                this.runningTasks.add(task.id);
                try {
                    await this.processTask(agent, task);
                } catch (error) {
                    console.error(`Heartbeat error for ${agent.name} on task ${task.id}:`, error);
                } finally {
                    this.runningTasks.delete(task.id);
                }
            });

            await Promise.all(promises);
        } catch (globalError) {
            console.error("Global Heartbeat Tick Error:", globalError);
        } finally {
            this.isProcessing = false;
        }
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

        // 2. Prepare task state for the 1B Orchestrator (Optimized for speed)
        const state = {
            project_id: task.projectId,
            project_name: task.projectName,
            project_context: task.projectContext,
            project_memory: task.projectMemory,
            task_id: task.id,
            title: task.title,
            status: task.status,
            history: history.slice(-5).map(h => ({
                role: h.role,
                content: h.content.trim().substring(0, 500) // Prune long messages
            }))
        };

        // 3. Get Project Agents Registry
        const allAgents = this.getAgents().filter(a => a.projectId === task.projectId);

        // 4. Query Orchestrator-1B for the next move
        console.log(`[Heartbeat] 🧠 Querying Orchestrator-1B for: "${task.title}"`);
        window.dispatchEvent(new CustomEvent('agent_thinking_start', { detail: { agentId: agent.id } }));
        const decision = await getOrchestrationDecision({ ...state, system_prompt: agent.systemPrompt }, allAgents);
        window.dispatchEvent(new CustomEvent('agent_thinking_stop', { detail: { agentId: agent.id } }));

        if (!decision) {
            console.warn("[Heartbeat] ⚠️ Orchestrator returned no response. Skipping task.");
            return;
        }

        console.log(`[Heartbeat] 🏁 Decision: ${decision.action} -> ${decision.target || 'null'} (Reason: ${decision.reason})`);

        // 5. Route based on action
        await this.updateTask(task.id, { last_decision: decision.reason });

        switch (decision.action) {
            case 'call_agent':
                await this.handleAgentCall(decision, agent, task, history);
                break;
            case 'call_tool':
                await this.handleToolCall(decision, agent, task);
                break;
            case 'ask_user':
                await this.updateTask(task.id, { status: 'needs_input', heartbeat: 1 });
                this.saveOrchestrationMessage(task.id, agent.id, `*(Needs Input: ${decision.reason})*`, true);
                showToast(`Agent ${agent.name} needs help on "${task.title}"`, 'info');
                break;
            case 'finish':
                const finalMsg = decision.final_answer || `*(Task completed: ${decision.reason})*`;
                await this.saveOrchestrationMessage(task.id, agent.id, finalMsg, true);
                await this.updateTaskCompletion(task.id);
                showToast(`Task "${task.title}" finished.`, 'success');
                break;
            default:
                console.error(`[Heartbeat] Unknown orchestrator action: ${decision.action}`);
        }
    }

    /**
     * Executes a tool via the orchestrator bridge
     */
    async handleToolCall(decision, currentAgent, task) {
        const { target, arguments: args } = decision;
        console.log(`[Heartbeat] 🛠️ Executing tool: ${target}`);

        try {
            const result = await executeToolAction(decision, {
                projectId: task.projectId,
                projectName: task.projectName,
                taskId: task.id,
                currentAgentId: currentAgent.id,
                agents: this.getAgents()
            });

            // Save tool result to the chat history (proactive)
            let resultStr = "Success";
            if (result && typeof result === 'object') {
                resultStr = JSON.stringify(result, null, 2);
            } else if (result !== undefined && result !== null) {
                resultStr = String(result);
            }

            // Limit length to avoid blowing up the context for the 1B model
            if (resultStr.length > 1000) resultStr = resultStr.substring(0, 1000) + "... (truncated)";

            const statusMsg = `*(Tool: ${target})* Result:\n\`\`\`json\n${resultStr}\n\`\`\``;
            await this.saveOrchestrationMessage(task.id, currentAgent.id, statusMsg, true);
            
            // Trigger UI refreshes based on tool
            if (target === 'create_task') window.dispatchEvent(new CustomEvent('ollamaclip_tasks_updated'));
            if (target === 'create_agent') window.dispatchEvent(new CustomEvent('ollamaclip_agents_updated'));

        } catch (error) {
            console.error(`[Heartbeat] Tool execution error (${target}):`, error);
        }
    }

    /**
     * Delegates work to a specialist model
     */
    async handleAgentCall(decision, currentAgent, task, history) {
        const targetName = decision.target;
        const targetAgent = this.getAgents().find(a => 
            (a.name === targetName || a.id === targetName) && 
            a.projectId === task.projectId
        );

        if (!targetAgent) {
            console.error(`[Heartbeat] ❌ Target agent "${targetName}" not found.`);
            return;
        }

        console.log(`[Heartbeat] 🤖 Delegating to: ${targetAgent.name} (${targetAgent.model})`);

        // Prepare context for the specialist
        const specialistPrompt = `${targetAgent.systemPrompt}
        
PROJECT: ${task.projectName}
CONTEXT: ${task.projectContext}
MEMORY: ${task.projectMemory}
TASK: ${task.title}
SUB-CONTEXT: ${task.context}

INSTRUCTIONS: ${decision.reason}
Args: ${JSON.stringify(decision.arguments || {})}`;

        const messages = [
            { role: 'system', content: specialistPrompt },
            ...history.slice(-5).map(h => ({ role: h.role, content: h.content })),
            { role: 'user', content: `Please proceed with the task according to the instructions.` }
        ];

        window.dispatchEvent(new CustomEvent('agent_thinking_start', { detail: { agentId: targetAgent.id } }));
        let fullReply = "";
        await chatWithModel(
            targetAgent.model,
            messages,
            targetAgent.options || {},
            (chunk) => { fullReply += chunk; },
            async () => {
                console.log(`[Heartbeat] Agent ${targetAgent.name} finished response.`);
                window.dispatchEvent(new CustomEvent('agent_thinking_stop', { detail: { agentId: targetAgent.id } }));
                await this.saveOrchestrationMessage(task.id, targetAgent.id, fullReply, true);
                
                // Update task status to show someone is working
                await this.updateTask(task.id, { status: `Working (${targetAgent.name})` });

                // UI notification
                if (this.onProactiveMessage) {
                    this.onProactiveMessage({
                        role: 'agent',
                        text: fullReply,
                        agentName: targetAgent.name,
                        agentColor: targetAgent.color || 'var(--accent-primary)',
                        isProactive: true,
                        taskTitle: task.title,
                        taskId: task.id
                    });
                }
            }
        );
    }

    /**
     * Helper to save a message and notify UI
     */
    async saveOrchestrationMessage(taskId, agentId, content, isProactive) {
        try {
            await fetch(`${API_URL}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, agentId, role: 'assistant', content, isProactive })
            });

            const agent = this.getAgents().find(a => a.id === agentId);
            window.dispatchEvent(new CustomEvent('ollamaclip_new_message', {
                detail: { agent, message: content, taskId }
            }));
        } catch (e) { console.error("[Heartbeat] Message save error:", e); }
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
