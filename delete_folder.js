import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetDir = path.join(__dirname, 'Workspaces', 'Main Project');

if (fs.existsSync(targetDir)) {
    console.log(`Deleting ${targetDir}...`);
    fs.rmSync(targetDir, { recursive: true, force: true });
    console.log('Deleted.');
} else {
    console.log('Not found.');
}
