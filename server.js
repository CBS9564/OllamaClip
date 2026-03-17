import express from 'express';
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
        await fs.unlink(filePath);
        console.log(`[Persistence] Deleted agent file: ${filename}`);
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

app.listen(PORT, () => {
    console.log(`\n🚀 [OllamaClip Backend] Persistence Bridge running at http://localhost:${PORT}`);
    console.log(`📂 Monitoring directory: ${AGENTS_DIR}\n`);
});
