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
            db.run(`CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                workspace_id TEXT,
                name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS agents_meta (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                filename TEXT,
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                agent_id TEXT,
                project_id TEXT,
                title TEXT NOT NULL,
                status TEXT DEFAULT '',
                heartbeat BOOLEAN DEFAULT 0,
                completed BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(agent_id) REFERENCES agents_meta(id),
                FOREIGN KEY(project_id) REFERENCES projects(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )`);
            
            // Insert default settings if they don't exist
            db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('ollamaclip_api_url', 'http://localhost:11434/api')");
            db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('ollamaclip_keep_alive', '5m')");

            ensureDefaultWorkspace();
            ensureDefaultProject();
        });
    }
});

function ensureDefaultWorkspace() {
    db.get("SELECT id, name FROM workspaces WHERE id = 'default_workspace'", (err, row) => {
        if (!row && !err) {
            db.run("INSERT INTO workspaces (id, name) VALUES ('default_workspace', 'My Global Workspace')");
            ensureWorkspaceDir('My Global Workspace');
        } else if (row) {
            ensureWorkspaceDir(row.name);
        }
    });
}

function ensureWorkspaceDir(name) {
    const dir = path.join(__dirname, 'Workspaces', name);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[Database] Created Workspace directory: ${dir}`);
    }
}

function ensureDefaultProject() {
    db.get("SELECT p.id, p.name, w.name as workspace_name FROM projects p JOIN workspaces w ON p.workspace_id = w.id WHERE p.id = 'default_project'", (err, row) => {
        if (!row && !err) {
            db.run("INSERT INTO projects (id, workspace_id, name) VALUES ('default_project', 'default_workspace', 'Main Project')");
            ensureProjectDir('My Global Workspace', 'Main Project');
        } else if (row) {
            ensureProjectDir(row.workspace_name, row.name);
        }
    });
}

export function ensureProjectDir(workspaceName, projectName) {
    const dir = path.join(__dirname, 'Workspaces', workspaceName, projectName);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[Database] Created Project directory: ${dir}`);
    }
}

export function getProjectPath(workspaceName, projectName) {
    return path.join(__dirname, 'Workspaces', workspaceName, projectName);
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
