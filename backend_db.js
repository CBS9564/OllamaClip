import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'ollamaclip.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("[Database] Error opening database " + err.message);
    } else {
        console.log("[Database] Connected to SQLite.");
        
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                context TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS agents_meta (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                parent_id TEXT,
                filename TEXT,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                FOREIGN KEY(parent_id) REFERENCES agents_meta(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                agent_id TEXT,
                project_id TEXT,
                title TEXT NOT NULL,
                context TEXT DEFAULT '',
                status TEXT DEFAULT '',
                heartbeat BOOLEAN DEFAULT 0,
                completed BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(agent_id) REFERENCES agents_meta(id),
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                task_id TEXT,
                agent_id TEXT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                is_proactive BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(task_id) REFERENCES tasks(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )`);
            
            // Insert default settings if they don't exist
            db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('ollamaclip_api_url', 'http://localhost:11434/api')");
            db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('ollamaclip_keep_alive', '5m')");

            
            // Migrations for existing DBs
            db.run("ALTER TABLE projects ADD COLUMN context TEXT DEFAULT ''", (err) => {
                if (err && !err.message.includes("duplicate column name")) console.log("[Database] Context column already exists in projects");
            });
            db.run("ALTER TABLE tasks ADD COLUMN context TEXT DEFAULT ''", (err) => {
                if (err && !err.message.includes("duplicate column name")) console.log("[Database] Context column already exists in tasks");
            });
            db.run("ALTER TABLE agents_meta ADD COLUMN parent_id TEXT", (err) => {
                if (err && !err.message.includes("duplicate column name")) console.log("[Database] parent_id column already exists in agents_meta");
            });

            ensureWorkspacesRoot();
        });
    }
});

/**
 * Fetch available models from local Ollama instance (Backend version)
 */
export async function fetchOllamaModels() {
    try {
        const settings = await dbQuery("SELECT value FROM settings WHERE key = 'ollamaclip_api_url'");
        let baseUrl = 'http://localhost:11434/api';
        if (settings && settings.length > 0) {
            baseUrl = settings[0].value.replace(/\/$/, '');
        }

        const response = await fetch(`${baseUrl}/tags`);
        if (!response.ok) return [];
        const data = await response.json();
        return data.models || [];
    } catch (error) {
        console.error("[Database] Failed to fetch Ollama models:", error.message);
        return [];
    }
}

/**
 * Select the best model based on availability and resources
 */
export async function getBestAvailableModel() {
    const models = await fetchOllamaModels();
    if (!models || models.length === 0) return 'llama3'; // Default fallback

    // Preference list (most capable models for orchestration)
    const preferences = ['llama3.1', 'llama3', 'mistral', 'phi3', 'gemma2'];
    
    // 1. Try to find a direct match from preferences
    for (const pref of preferences) {
        const found = models.find(m => m.name.toLowerCase().includes(pref));
        if (found) return found.name;
    }

    // 2. If no preferred model, pick the largest one that is likely to fit (under 10GB for safety)
    const safeModels = models.filter(m => m.size < 10 * 1024 * 1024 * 1024); // 10GB limit
    if (safeModels.length > 0) {
        // Sort by size descending to get the most "powerful" safe model
        safeModels.sort((a, b) => b.size - a.size);
        return safeModels[0].name;
    }

    // 3. Absolute fallback
    return models[0].name;
}

function ensureWorkspacesRoot() {
    const dir = path.join(__dirname, 'Workspaces');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function ensureDefaultProject() {
    ensureWorkspacesRoot();
    db.get("SELECT p.id, p.name FROM projects p WHERE p.id = 'default_project'", (err, row) => {
        if (!row && !err) {
            db.run("INSERT INTO projects (id, name) VALUES ('default_project', 'Main Project')");
            ensureProjectDir('Main Project');
        } else if (row) {
            ensureProjectDir(row.name);
        }
    });
}

export function ensureProjectDir(projectName) {
    const dir = path.join(__dirname, 'Workspaces', projectName);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[Database] Created Project directory: ${dir}`);
    }
}

export function getProjectPath(projectName) {
    return path.join(__dirname, 'Workspaces', projectName);
}

export function ensureAgentDir(projectName) {
    const projectDir = getProjectPath(projectName);
    const agentDir = path.join(projectDir, 'Agent');
    if (!fs.existsSync(agentDir)) {
        fs.mkdirSync(agentDir, { recursive: true });
        console.log(`[Database] Created Agent directory: ${agentDir}`);
    }
    return agentDir;
}

export function getProjectAgentsPath(projectName) {
    return path.join(__dirname, 'Workspaces', projectName, 'Agent');
}

// Wrapper for promises
export const dbQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

export const dbRun = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

export const dbGet = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

export default db;
