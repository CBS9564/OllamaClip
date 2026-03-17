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
id: ${agent.id}
name: "${agent.name}"
role: "${agent.role}"
model: "${agent.model}"
color: "${agent.color || '#6366f1'}"
temperature: ${agent.options?.temperature ?? 0.7}
num_ctx: ${agent.options?.num_ctx ?? 2048}
---

# System Prompt
${agent.systemPrompt}
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
                const v = valParts.join(':').trim().replace(/^"(.*)"$/, '$1');
                
                if (k === 'id') agent.id = v;
                if (k === 'name') agent.name = v;
                if (k === 'role') agent.role = v;
                if (k === 'model') agent.model = v;
                if (k === 'color') agent.color = v;
                if (k === 'temperature') agent.options.temperature = parseFloat(v);
                if (k === 'num_ctx') agent.options.num_ctx = parseInt(v);
            }
        } else if (line.trim() === '# System Prompt') {
            inPrompt = true;
        } else if (inPrompt) {
            promptContent.push(line);
        }
    }

    agent.systemPrompt = promptContent.join('\n').trim();
    return agent;
}

// Routes
app.post('/api/save-agent', async (req, res) => {
    try {
        await ensureDir();
        const agent = req.body;
        // Filename: agent_Name_Role.md (sanitize names)
        const safeName = agent.name.replace(/[^a-z0-9]/gi, '_');
        const safeRole = agent.role.replace(/[^a-z0-9]/gi, '_');
        const filename = `agent_${safeName}_${safeRole}.md`;
        
        const mdContent = jsonToMarkdown(agent);
        await fs.writeFile(path.join(AGENTS_DIR, filename), mdContent, 'utf-8');
        
        console.log(`[Persistence] Saved agent: ${filename}`);
        res.json({ success: true, filename });
    } catch (error) {
        console.error("Save error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/delete-agent', async (req, res) => {
    try {
        const { name, role } = req.body;
        const safeName = name.replace(/[^a-z0-9]/gi, '_');
        const safeRole = role.replace(/[^a-z0-9]/gi, '_');
        const filename = `agent_${safeName}_${safeRole}.md`;
        
        await fs.unlink(path.join(AGENTS_DIR, filename));
        console.log(`[Persistence] Deleted agent file: ${filename}`);
        res.json({ success: true });
    } catch (error) {
        console.error("Delete error:", error);
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
                agents.push(markdownToJson(content, file));
            }
        }
        
        res.json(agents);
    } catch (error) {
        console.error("Load error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 [OllamaClip Backend] Persistence Bridge running at http://localhost:${PORT}`);
    console.log(`📂 Monitoring directory: ${AGENTS_DIR}\n`);
});
