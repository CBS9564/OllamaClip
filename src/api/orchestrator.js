/**
 * Orchestrator Service
 * Communicates with the /api/orchestrate endpoint to get JSON-based decisions.
 */
const API_URL = 'http://localhost:3001/api';

/**
 * Gets the next orchestration action
 * @param {Object} state - The current task state (task, context, history, etc.)
 * @param {Array} agents - The list of available agents in the project
 * @returns {Promise<Object>} The JSON action
 */
export async function getOrchestrationDecision(state, agents) {
    window.dispatchEvent(new CustomEvent('ollama_thinking_start'));
    try {
        const response = await fetch(`${API_URL}/orchestrate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                state, 
                agent_registryArray: agents.map(a => ({
                    id: a.id,
                    name: a.name,
                    role: a.role,
                    model: a.model
                }))
            })
        });

        if (!response.ok) throw new Error("Orchestration failed");
        return await response.json();
    } catch (error) {
        console.error("Orchestration error:", error);
        // Fallback or retry logic could go here
        return null;
    } finally {
        window.dispatchEvent(new CustomEvent('ollama_thinking_stop'));
    }
}

/**
 * Executes a tool action based on the orchestrator's decision
 * @param {Object} action - The action object {action, target, arguments}
 * @param {Object} context - Context containing projectId, taskId, etc.
 */
export async function executeToolAction(action, context) {
    const { target, arguments: args } = action;
    
    switch (target) {
        case 'save_file':
            const resSave = await fetch(`${API_URL}/workspace/file`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    filename: args.filename,
                    content: args.content,
                    projectName: context.projectName
                })
            });
            if (resSave.ok) return await resSave.json();
            return { error: `Failed to save file: ${resSave.statusText}` };

        case 'create_task':
            let resolvedAgentId = args.agent_id;
            const foundAgent = (context.agents || []).find(a => a.name === args.agent_id || a.id === args.agent_id);
            if (foundAgent) resolvedAgentId = foundAgent.id;

            const resTask = await fetch(`${API_URL}/tasks`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    id: `task-${Date.now()}-${Math.floor(Math.random()*1000)}`,
                    title: args.title,
                    agentId: resolvedAgentId, 
                    projectId: context.projectId,
                    status: 'open',
                    completed: 0,
                    heartbeat: 1,
                    context: args.context || ''
                })
            });
            if (resTask.ok) return await resTask.json();
            return { error: `Failed to create task: ${resTask.statusText}` };

        case 'create_agent':
            const resAgent = await fetch(`${API_URL}/save-agent`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    name: args.name,
                    role: args.role,
                    model: args.model || 'auto',
                    systemPrompt: args.system_prompt,
                    projectId: context.projectId,
                    parentId: context.currentAgentId
                })
            });
            if (resAgent.ok) return await resAgent.json();
            return { error: `Failed to save agent: ${resAgent.statusText}` };

        case 'update_task':
            const resUpTask = await fetch(`${API_URL}/tasks/${context.taskId}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    status: args.status,
                    completed: args.completed || false,
                    heartbeat: !args.completed
                })
            });
            if (resUpTask.ok) return await resUpTask.json();
            return { error: `Failed to update task: ${resUpTask.statusText}` };

        case 'update_memory':
            const resMem = await fetch(`${API_URL}/projects/${context.projectId}/memory`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ memory: args.memory })
            });
            if (resMem.ok) return await resMem.json();
            return { error: `Failed to update memory: ${resMem.statusText}` };

        case 'list_files':
        case 'get_project_metadata':
        case 'get_project_files':
            const fRes = await fetch(`${API_URL}/workspace/files/${context.projectName}`);
            if (fRes.ok) return await fRes.json();
            return { error: "Could not list files" };

        default:
            console.warn("Unknown tool target:", target);
            return null;
    }
}
