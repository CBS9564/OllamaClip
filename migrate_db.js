import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('ollamaclip.db');

db.serialize(() => {
    db.run("ALTER TABLE projects ADD COLUMN context TEXT DEFAULT ''", (err) => {
        if (err) console.log('projects migrate:', err.message);
        else console.log('projects migrate: success');
    });
    db.run("ALTER TABLE tasks ADD COLUMN context TEXT DEFAULT ''", (err) => {
        if (err) console.log('tasks migrate:', err.message);
        else console.log('tasks migrate: success');
    });
});
db.close();
