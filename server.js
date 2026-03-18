import express from 'express';
import { getProjectPath, dbQuery, dbRun, dbGet, ensureProjectDir, ensureAgentDir, getProjectAgentsPath } from './backend_db.js';
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

// Routes
app.post('/api/save-agent', async (req, res) => {
    try {
        const agent = req.body;
        if (!agent || !agent.name || !agent.role) {
            return res.status(400).json({ error: "Missing agent name or role" });
        }

        const projectId = agent.projectId || 'default_project';
        
        // Resolve Project name for path creation
        const proj = await dbGet(`SELECT name as project_name FROM projects WHERE id = ?`, [projectId]);
        if (!proj) return res.status(404).json({ error: "Project not found" });

        const agentDir = ensureAgentDir(proj.project_name);
        const safeName = agent.name.replace(/[^a-z0-9]/gi, '_');
        const safeRole = agent.role.replace(/[^a-z0-9]/gi, '_');
        const filename = `agent_${safeName}_${safeRole}.md`;
        
        const mdContent = jsonToMarkdown(agent);
        await fs.writeFile(path.join(agentDir, filename), mdContent, 'utf-8');
        
        // Sync with SQLite
        await dbRun(
            `INSERT INTO agents_meta (id, project_id, filename) VALUES (?, ?, ?) 
             ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, filename = excluded.filename`,
            [agent.id, projectId, filename]
        );

        console.log(`[Persistence] Saved agent to ${proj.project_name}/Agents/: ${filename}`);
        res.json({ success: true, filename });
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

app.get('/api/workspaces', async (req, res) => {
    try {
        const workspaces = await dbQuery("SELECT * FROM workspaces ORDER BY created_at ASC");
        res.json(workspaces);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects', async (req, res) => {
    try {
        const projects = await dbQuery("SELECT * FROM projects ORDER BY created_at ASC");
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: "Name is required" });
        
        const id = 'project_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        await dbRun("INSERT INTO projects (id, name) VALUES (?, ?)", [id, name]);
        
        ensureProjectDir(name);
        res.json({ id, name, success: true });
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
            SELECT t.*, p.name as project_name
            FROM tasks t
            LEFT JOIN projects p ON t.project_id = p.id
        `;
        const tasks = await dbQuery(sql);
        // SQLite stores boolean as 0/1, map back to true/false for frontend
        const mappedTasks = tasks.map(t => ({
            ...t,
            completed: !!t.completed,
            heartbeat: !!t.heartbeat,
            agentId: t.agent_id,
            projectId: t.project_id,
            projectName: t.project_name,
            createdAt: t.created_at
        }));
        res.json(mappedTasks);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const { id, title, agentId, projectId, completed, status } = req.body;
        const pId = projectId || 'default_project';
        const st = status || 'open';
        
        await dbRun(
            `INSERT INTO tasks (id, agent_id, project_id, title, status, completed) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, agentId || null, pId, title, st, completed ? 1 : 0]
        );
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/tasks/:id', async (req, res) => {
    try {
        const taskId = req.params.id;
        const { title, agentId, heartbeat, completed, status } = req.body;
        
        let updates = [];
        let params = [];
        
        if (title !== undefined) { updates.push('title = ?'); params.push(title); }
        if (agentId !== undefined) { updates.push('agent_id = ?'); params.push(agentId); }
        if (heartbeat !== undefined) { updates.push('heartbeat = ?'); params.push(heartbeat ? 1 : 0); }
        if (completed !== undefined) { updates.push('completed = ?'); params.push(completed ? 1 : 0); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }
        
        if (updates.length > 0) {
            params.push(taskId);
            await dbRun(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, params);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        await dbRun(`DELETE FROM tasks WHERE id = ?`, [req.params.id]);
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
