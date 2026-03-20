import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('ollamaclip.db');

db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const checkNext = (index) => {
    if (index >= tables.length) {
      db.close();
      return;
    }
    const table = tables[index].name;
    db.all(`SELECT * FROM "${table}"`, (err, rows) => {
      if (!err) {
        rows.forEach(row => {
          const rowStr = JSON.stringify(row);
          if (rowStr.toLowerCase().includes('main project')) {
            console.log(`Match found in Table: ${table}`);
            console.log(rowStr);
          }
        });
      }
      checkNext(index + 1);
    });
  };
  checkNext(0);
});
