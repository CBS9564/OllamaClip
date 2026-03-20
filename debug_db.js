import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'ollamaclip.db');

const db = new sqlite3.Database(dbPath);

console.log("--- AGENTS META ---");
db.all("SELECT id, project_id, parent_id, filename FROM agents_meta", [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.table(rows);
    }

    console.log("\n--- PROJECTS ---");
    db.all("SELECT id, name FROM projects", [], (err, rows) => {
        if (err) console.error(err);
        else console.table(rows);
        db.close();
    });
});
