import express from 'express';
import { getProjectPath, dbQuery, dbRun, dbGet, ensureProjectDir, ensureAgentDir, getProjectAgentsPath, fetchOllamaModels, getBestAvailableModel } from './backend_db.js';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// Helper to resolve an agent's path based on their project
async function resolveAgentPath(agentId, filename) {
    // 1. Try to find in DB
    const meta = await dbGet(`
        SELECT p.name as project_name
        FROM agents_meta a
        JOIN projects p ON a.project_id = p.id
        WHERE a.id = ?`, [agentId]);

    if (meta) {
        return path.join(getProjectAgentsPath(meta.project_name), filename);
    }
    
    // Fallback if not found in DB
    throw new Error(`Agent ${agentId} not found in database.`);
}

// Convert Agent JSON to Markdown
function jsonToMarkdown(agent) {
    return `---
id: ${agent.id || Date.now().toString()}
parent_id: ${agent.parentId || ''}
name: "${agent.name || ''}"
role: "${agent.role || ''}"
model: "${agent.model || ''}"
color: "${agent.color || '#6366f1'}"
temperature: ${agent.options?.temperature ?? 0.7}
num_ctx: ${agent.options?.num_ctx ?? 2048}
---

# System Prompt
${agent.systemPrompt || ''}
`;
}

// Parse Markdown back to Agent JSON
function markdownToJson(content, filename) {
    const lines = content.split('\n');
    const agent = { options: {} };
    let inFrontmatter = false;
    let inPrompt = false;
    let promptContent = [];

    for (const line of lines) {
        if (line.trim() === '---') {
            inFrontmatter = !inFrontmatter;
            continue;
        }

        if (inFrontmatter) {
            const [key, ...valParts] = line.split(':');
            if (key && valParts.length > 0) {
                const k = key.trim();
                let v = valParts.join(':').trim().replace(/^"(.*)"$/, '$1');
                
                if (v === 'undefined') v = undefined;

                if (k === 'id') agent.id = v || Date.now().toString();
                if (k === 'parent_id') agent.parentId = v === 'undefined' ? '' : v;
                if (k === 'name') agent.name = v || 'Unnamed Agent';
                if (k === 'role') agent.role = v || 'Assistant';
                if (k === 'model') agent.model = v || 'llama3';
                if (k === 'color') agent.color = v || '#6366f1';
                if (k === 'temperature') agent.options.temperature = parseFloat(v) || 0.7;
                if (k === 'num_ctx') agent.options.num_ctx = parseInt(v) || 2048;
            }
        } else if (line.trim() === '# System Prompt') {
            inPrompt = true;
            continue; // Skip the header line itself
        } else if (inPrompt) {
            promptContent.push(line);
        }
    }

    const fullPrompt = promptContent.join('\n').trim();
    agent.systemPrompt = fullPrompt === 'undefined' ? '' : fullPrompt;
    return agent;
}

// Helper to save agent internally
async function saveAgentInternal(agent) {
    if (!agent || !agent.name || !agent.role) {
        throw new Error("Missing agent name or role");
    }

    const projectId = agent.projectId || 'default_project';
    
    // Resolve Project name for path creation
    const proj = await dbGet(`SELECT name as project_name FROM projects WHERE id = ?`, [projectId]);
    if (!proj) throw new Error("Project not found");

    const agentDir = ensureAgentDir(proj.project_name);
    const safeName = agent.name.replace(/[^a-z0-9]/gi, '_');
    const safeRole = agent.role.replace(/[^a-z0-9]/gi, '_');
    const filename = `agent_${safeName}_${safeRole}.md`;
    
    const agentData = {
        ...agent,
        id: agent.id || 'agent_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    };

    // ENSURE MODEL IS DESCRIPTIVE AND AVAILABLE
    if (!agentData.model || agentData.model.toLowerCase() === 'auto' || agentData.model.trim() === '') {
        agentData.model = await getBestAvailableModel();
        console.log(`[Persistence] Auto-assigned model '${agentData.model}' to agent: ${agentData.name}`);
    } else {
        // EXACT NOMENCLATURE CHECK: If the agent provides 'llama3', verify contextually
        const available = await fetchOllamaModels();
        const modelLower = agentData.model.toLowerCase();
        
        // 1. Try exact case-insensitive match (highest priority)
        const exactMatch = available.find(m => m.name.toLowerCase() === modelLower);
        if (exactMatch) {
            agentData.model = exactMatch.name; // Use the canonical name from Ollama
        } else {
            // 2. Try adding ":latest" if not already present
            if (!modelLower.includes(':')) {
                const latestMatch = available.find(m => m.name.toLowerCase() === modelLower + ':latest');
                if (latestMatch) {
                    agentData.model = latestMatch.name;
                } else {
                    // 3. Try prefix match / base name match (e.g., 'llama3.2' matching 'llama3.2:1b')
                    // If multiple matches exist (like llama3.2:1b and llama3.2:latest), prefix match will pick first
                    const matches = available.filter(m => m.name.toLowerCase().startsWith(modelLower + ':') || m.name.toLowerCase().split(':')[0] === modelLower);
                    if (matches.length > 0) {
                        // Prefer :latest among matches if available, otherwise pick first
                        const bestMatch = matches.find(m => m.name.toLowerCase().endsWith(':latest')) || matches[0];
                        console.log(`[Persistence] Remapping agent model '${agentData.model}' to canonical '${bestMatch.name}' (Matched among ${matches.length} candidates)`);
                        agentData.model = bestMatch.name;
                    } else if (available.length > 0) {
                        // 4. Last fallback: if specified model doesn't exist at all, use best
                        console.warn(`[Persistence] Model '${agentData.model}' not found in available models. Falling back to best available.`);
                        agentData.model = await getBestAvailableModel();
                    }
                }
            } else if (available.length > 0) {
                // If it has a tag but wasn't an exact match, it might be a partial path or typo
                console.warn(`[Persistence] Model '${agentData.model}' not found exactly. Falling back to best available.`);
                agentData.model = await getBestAvailableModel();
            }
        }
    }

    const mdContent = jsonToMarkdown(agentData);
    await fs.writeFile(path.join(agentDir, filename), mdContent, 'utf-8');
    
    // Sync with SQLite
    await dbRun(
        `INSERT INTO agents_meta (id, project_id, parent_id, filename) VALUES (?, ?, ?, ?) 
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, parent_id = excluded.parent_id, filename = excluded.filename`,
        [agentData.id, projectId, agentData.parentId || null, filename]
    );

    console.log(`[Persistence] Saved agent to ${proj.project_name}/Agent/: ${filename}`);
    return { filename, id: agentData.id };
}

// Routes
app.post('/api/save-agent', async (req, res) => {
    try {
        const result = await saveAgentInternal(req.body);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error("[Persistence] Save error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/delete-agent', async (req, res) => {
    try {
        const { id, filename } = req.body;
        if (!id || !filename) return res.status(400).json({ error: "Missing agent ID or filename" });

        const filePath = await resolveAgentPath(id, filename);
        try { 
            await fs.unlink(filePath); 
            console.log(`[Persistence] Physically deleted agent file: ${filePath}`);
        } catch (e) { 
            console.warn(`[Persistence] Could not delete file ${filePath}:`, e.message);
        }
        
        await dbRun(`DELETE FROM tasks WHERE agent_id = ?`, [id]);
        await dbRun(`DELETE FROM agents_meta WHERE id = ?`, [id]);

        console.log(`[Persistence] Deleted agent: ${filename}`);
        res.json({ success: true });
    } catch (error) {
        console.error("[Persistence] Delete error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/load-agents', async (req, res) => {
    try {
        const agents = [];
        const seenIds = new Set();

        // 1. Load agents registered in database across all projects
        const dbAgents = await dbQuery(`
            SELECT a.*, p.name as project_name
            FROM agents_meta a
            JOIN projects p ON a.project_id = p.id
        `);

        for (const entry of dbAgents) {
            const agentPath = path.join(getProjectAgentsPath(entry.project_name), entry.filename);
            try {
                const content = await fs.readFile(agentPath, 'utf-8');
                const agent = markdownToJson(content, entry.filename);
                agent.projectId = entry.project_id;
                agent.parentId = entry.parent_id;
                agent.filename = entry.filename; // CRITICAL: Fix for deletion
                agents.push(agent);
                seenIds.add(agent.id);
            } catch (e) { console.warn(`[Persistence] Agent file missing at ${agentPath}`); }
        }

        res.json(agents);
    } catch (error) {
        console.error("[Persistence] Load error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- WORKSPACE & PROJECT Endpoints ---


app.get('/api/projects', async (req, res) => {
    try {
        const sql = `
            SELECT p.*,
            (SELECT content FROM chat_messages WHERE task_id = p.id ORDER BY created_at DESC LIMIT 1) as last_message
            FROM projects p
            ORDER BY created_at ASC
        `;
        const projects = await dbQuery(sql);
        res.json(projects.map(p => ({
            ...p,
            lastMessage: p.last_message
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/best-model', async (req, res) => {
    try {
        const best = await getBestAvailableModel();
        const all = await fetchOllamaModels();
        res.json({ best, all: all.map(m => m.name) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const { name, context } = req.body;
        if (!name) return res.status(400).json({ error: "Name is required" });
        
        const id = 'project_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        await dbRun("INSERT INTO projects (id, name, context) VALUES (?, ?, ?)", [id, name, context || '']);
        
        ensureProjectDir(name);

        // DYNAMIC MODEL SELECTION
        const bestModel = await getBestAvailableModel();
        const availableModels = await fetchOllamaModels();
        const modelListStr = availableModels.map(m => m.name).join(', ') || bestModel;

        // CREATE CEO AGENT AUTOMATICALLY
        const ceoId = 'agent_ceo_' + Date.now().toString(36);
        const ceoAgent = {
            id: ceoId,
            name: "CEO",
            role: "Chief Executive Officer",
            model: bestModel,
            color: "#6366f1",
            projectId: id,
            systemPrompt: `You are the CEO (Chief Executive Officer) of this project. 
Your goal is to analyze the project context, define a strategic roadmap, and coordinate a team of specialized agents.

PROJECT CONTEXT:
${context || 'No specific context provided.'}

AVAILABLE MODELS ON SERVER:
[${modelListStr}]

Your first mission is to:
1. Decompose the project into a list of initial tasks using [TASK_CREATE].
2. Identify and create the specialized agents needed (e.g., Architect, Developer, Tester) using [AGENT_CREATE].
3. Assign the tasks to these agents.

⚠️ IMPORTANT: When creating agents with [AGENT_CREATE], choose the most appropriate model from the "AVAILABLE MODELS" list above. If you are unsure, use "${bestModel}".

To create an agent: [AGENT_CREATE: Name | Role | Model | SystemPrompt]
To create a task: [TASK_CREATE: Title | AgentName | Context]

Always start by defining your team and the high-level plan.`,
            options: {
                temperature: 0.5,
                num_ctx: 4096
            }
        };

        const result = await saveAgentInternal(ceoAgent);
        console.log(`[Persistence] Auto-created CEO agent for project: ${name}`);

        // INITIAL TASK FOR CEO
        const taskId = 'task_init_' + Date.now().toString(36);
        await dbRun(
            "INSERT INTO tasks (id, agent_id, project_id, title, context, heartbeat, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [taskId, ceoId, id, "Strategic Roadmap & Team Building", "Analyze the project objectives and create the necessary agents and tasks to begin work.", 1, "Planning"]
        );
        console.log(`[Persistence] Created initial task for CEO: ${taskId}`);

        res.json({ 
            id, 
            name, 
            context: context || '', 
            ceo: { ...ceoAgent, filename: result.filename }, 
            success: true 
        });
    } catch (error) {
        console.error("[Persistence] Project creation error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/projects/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const { name, context } = req.body;
        
        let updates = [];
        let params = [];
        
        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (context !== undefined) { updates.push('context = ?'); params.push(context); }
        
        if (updates.length > 0) {
            params.push(id);
            await dbRun(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/projects/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (id === 'default_project') {
            return res.status(400).json({ error: "Cannot delete the default project." });
        }
        
        // 1. Get project info first
        const proj = await dbGet("SELECT name FROM projects WHERE id = ?", [id]);
        if (!proj) return res.status(404).json({ error: "Project not found" });

        // 2. Cascade DB deletions
        await dbRun("DELETE FROM chat_messages WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)", [id]);
        await dbRun("DELETE FROM chat_messages WHERE task_id = ?", [id]); // Also delete project-wide chat
        await dbRun("DELETE FROM tasks WHERE project_id = ?", [id]);
        await dbRun("DELETE FROM agents_meta WHERE project_id = ?", [id]);
        await dbRun("DELETE FROM projects WHERE id = ?", [id]);

        // 3. Physical deletion of the project folder
        const projectPath = getProjectPath(proj.name);
        try {
            await fs.rm(projectPath, { recursive: true, force: true });
            console.log(`[Persistence] Recursively deleted project folder: ${projectPath}`);
        } catch (e) {
            console.error(`[Persistence] Error deleting folder ${projectPath}:`, e);
        }

        res.json({ success: true });
    } catch (error) {
        console.error("[Persistence] Project deletion error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- SETTINGS Endpoints ---
app.get('/api/settings', async (req, res) => {
    try {
        const rows = await dbQuery("SELECT key, value FROM settings");
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const settings = req.body;
        // SQLite 3.24+ supports UPSERT
        for (const key in settings) {
            await dbRun("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, settings[key]]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- TASK (SQLite) Endpoints ---

app.get('/api/tasks', async (req, res) => {
    try {
        const sql = `
            SELECT t.*, p.name as project_name, p.context as project_context,
            (SELECT content FROM chat_messages WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
            FROM tasks t
            LEFT JOIN projects p ON t.project_id = p.id
        `;
        const tasks = await dbQuery(sql);
        // SQLite stores boolean as 0/1, map back to true/false for frontend
        const mappedTasks = tasks.map(t => ({
            ...t,
            lastMessage: t.last_message,
            completed: !!t.completed,
            heartbeat: !!t.heartbeat,
            agentId: t.agent_id,
            projectId: t.project_id,
            projectName: t.project_name,
            projectContext: t.project_context,
            createdAt: t.created_at
        }));
        res.json(mappedTasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const { id, title, context, agentId, projectId, completed, status } = req.body;
        const pId = projectId || 'default_project';
        const st = status || 'open';
        
        await dbRun(
            `INSERT INTO tasks (id, agent_id, project_id, title, context, status, completed) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, agentId || null, pId, title, context || '', st, completed ? 1 : 0]
        );
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/tasks/:id', async (req, res) => {
    try {
        const taskId = req.params.id;
        const { title, context, agentId, heartbeat, completed, status } = req.body;
        
        let updates = [];
        let params = [];
        
        if (title !== undefined) { updates.push('title = ?'); params.push(title); }
        if (context !== undefined) { updates.push('context = ?'); params.push(context); }
        if (agentId !== undefined) { updates.push('agent_id = ?'); params.push(agentId); }
        if (heartbeat !== undefined) { updates.push('heartbeat = ?'); params.push(heartbeat ? 1 : 0); }
        if (completed !== undefined) { updates.push('completed = ?'); params.push(completed ? 1 : 0); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }
        
        if (updates.length > 0) {
            params.push(taskId);
            await dbRun(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, params);
            console.log(`[Persistence] Updated task ${taskId}: ${updates.join(', ')} (Params: ${params.slice(0, -1)})`);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const taskId = req.params.id;
        await dbRun(`DELETE FROM chat_messages WHERE task_id = ?`, [taskId]);
        await dbRun(`DELETE FROM tasks WHERE id = ?`, [taskId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- CHAT (MESSAGES) Endpoints ---

app.get('/api/chat/:taskId', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        const messages = await dbQuery("SELECT * FROM chat_messages WHERE task_id = ? ORDER BY created_at ASC", [taskId]);
        res.json(messages.map(m => ({
            ...m,
            isProactive: !!m.is_proactive,
            agentId: m.agent_id,
            taskId: m.task_id,
            createdAt: m.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { taskId, agentId, role, content, isProactive } = req.body;
        if (!taskId || !role || !content) return res.status(400).json({ error: "Missing required fields" });
        
        const id = 'msg_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        await dbRun(
            "INSERT INTO chat_messages (id, task_id, agent_id, role, content, is_proactive) VALUES (?, ?, ?, ?, ?, ?)",
            [id, taskId, agentId || null, role, content, isProactive ? 1 : 0]
        );
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/chat/task/:taskId', async (req, res) => {
    try {
        const taskId = req.params.taskId;
        await dbRun("DELETE FROM chat_messages WHERE task_id = ?", [taskId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- WORKSPACE FILE Endpoints ---

app.post('/api/workspace/file', async (req, res) => {
    try {
        const { filename, content, projectName } = req.body;
        if (!filename || !projectName) {
            return res.status(400).json({ error: "Missing filename or projectName" });
        }

        const projectPath = getProjectPath(projectName);
        
        // Security: prevent path traversal while allowing subfolders inside project
        const fullPath = path.normalize(path.join(projectPath, filename));
        if (!fullPath.startsWith(path.resolve(projectPath))) {
            return res.status(403).json({ error: "Access denied: Path is outside project boundary." });
        }

        // Ensure subdirectories exist
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        await fs.writeFile(fullPath, content || '', 'utf-8');
        console.log(`[Workspace] Agent saved file in project: ${fullPath}`);
        res.json({ success: true, path: fullPath });
    } catch (error) {
        console.error("[Workspace] File save error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 [OllamaClip Backend] Persistence Bridge running at http://localhost:${PORT}\n`);
});
