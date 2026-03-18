import express from 'express';
import { getProjectPath, dbQuery, dbRun, dbGet, ensureProjectDir } from './backend_db.js';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const AGENTS_DIR = path.join(__dirname, 'Agent');

app.use(cors());
app.use(bodyParser.json());

// Helper to ensure Agent directory exists
async function ensureDir() {
    try {
        await fs.access(AGENTS_DIR);
    } catch {
        await fs.mkdir(AGENTS_DIR);
    }
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
        await ensureDir();
        const agent = req.body;
        
        if (!agent || !agent.name || !agent.role) {
            console.error("[Persistence] Error: Missing agent data in request body", req.body);
            return res.status(400).json({ error: "Missing agent name or role" });
        }

        // Filename: agent_Name_Role.md (sanitize names)
        const safeName = agent.name.replace(/[^a-z0-9]/gi, '_');
        const safeRole = agent.role.replace(/[^a-z0-9]/gi, '_');
        const filename = `agent_${safeName}_${safeRole}.md`;
        
        const mdContent = jsonToMarkdown(agent);
        await fs.writeFile(path.join(AGENTS_DIR, filename), mdContent, 'utf-8');
        
        // Sync with SQLite
        const projectId = agent.projectId || 'default_project';
        await dbRun(
            `INSERT INTO agents_meta (id, project_id, filename) VALUES (?, ?, ?) 
             ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, filename = excluded.filename`,
            [agent.id, projectId, filename]
        );

        console.log(`[Persistence] Saved agent: ${filename}`);
        res.json({ success: true, filename });
    } catch (error) {
        console.error("[Persistence] Save error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/delete-agent', async (req, res) => {
    try {
        const { name, role, filename: providedFilename } = req.body;
        let filename = providedFilename;

        if (!filename && name && role) {
            const safeName = name.replace(/[^a-z0-9]/gi, '_');
            const safeRole = role.replace(/[^a-z0-9]/gi, '_');
            filename = `agent_${safeName}_${safeRole}.md`;
        }

        if (!filename) {
            return res.status(400).json({ error: "Missing filename or name/role" });
        }
        
        const filePath = path.join(AGENTS_DIR, filename);
        try { await fs.unlink(filePath); } catch (e) { /* ignore if already gone */ }
        
        // Sync with SQLite
        await dbRun(`DELETE FROM tasks WHERE agent_id = (SELECT id FROM agents_meta WHERE filename = ?)`, [filename]);
        await dbRun(`DELETE FROM agents_meta WHERE filename = ?`, [filename]);

        console.log(`[Persistence] Deleted agent file & records: ${filename}`);
        res.json({ success: true });
    } catch (error) {
        console.error("[Persistence] Delete error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/load-agents', async (req, res) => {
    try {
        await ensureDir();
        const files = await fs.readdir(AGENTS_DIR);
        const agents = [];
        
        for (const file of files) {
            if (file.endsWith('.md')) {
                const content = await fs.readFile(path.join(AGENTS_DIR, file), 'utf-8');
                const agent = markdownToJson(content, file);
                agent.filename = file; // Store filename in agent object
                agents.push(agent);
            }
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
        await dbRun("INSERT INTO projects (id, workspace_id, name) VALUES (?, 'default_workspace', ?)", [id, name]);
        
        ensureProjectDir('My Global Workspace', name);
        res.json({ id, name, workspace_id: 'default_workspace', success: true });
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
        
        // Let SQLite handle CASCADE or just orphans, but for UI sake we delete the project marker.
        await dbRun("DELETE FROM projects WHERE id = ?", [id]);
        res.json({ success: true });
    } catch (error) {
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
            SELECT t.*, p.name as project_name, w.name as workspace_name 
            FROM tasks t
            LEFT JOIN projects p ON t.project_id = p.id
            LEFT JOIN workspaces w ON p.workspace_id = w.id
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
            workspaceName: t.workspace_name,
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
        const { filename, content, workspaceName, projectName } = req.body;
        if (!filename || !workspaceName || !projectName) {
            return res.status(400).json({ error: "Missing filename, workspaceName or projectName" });
        }

        const projectPath = getProjectPath(workspaceName, projectName);
        // Security: prevent path traversal
        const safeFilename = path.basename(filename);
        const filePath = path.join(projectPath, safeFilename);

        await fs.writeFile(filePath, content || '', 'utf-8');
        console.log(`[Workspace] Agent saved file: ${filePath}`);
        res.json({ success: true, path: filePath });
    } catch (error) {
        console.error("[Workspace] File save error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 [OllamaClip Backend] Persistence Bridge running at http://localhost:${PORT}`);
    console.log(`📂 Monitoring directory: ${AGENTS_DIR}\n`);
});
