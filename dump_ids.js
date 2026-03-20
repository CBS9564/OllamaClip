import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'ollamaclip.db');

const db = new sqlite3.Database(dbPath);

console.log("--- DEBUG AGENTS IDs ---");
db.all("SELECT id, parent_id, filename, project_id FROM agents_meta", [], (err, rows) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    
    rows.forEach(row => {
        console.log(`DB_ID: ${row.id} | PARENT_ID: ${row.parent_id || 'NULL'} | FILE: ${row.filename}`);
        
        // Try to find the project name to read the file
        db.get("SELECT name FROM projects WHERE id = ?", [row.project_id], (err, proj) => {
            if (proj) {
                const filePath = path.join(__dirname, 'Workspaces', proj.name, 'Agent', row.filename);
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const idMatch = content.match(/^id:\s*(.*)$/m);
                    const parentMatch = content.match(/^parent_id:\s*(.*)$/m);
                    console.log(`   -> MD_ID: ${idMatch ? idMatch[1].trim() : 'MISSING'} | MD_PARENT: ${parentMatch ? parentMatch[1].trim() : 'MISSING'}`);
                } else {
                    console.log(`   -> FILE NOT FOUND: ${filePath}`);
                }
            }
        });
    });
    
    setTimeout(() => {
        db.close();
    }, 2000);
});
