import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_BASE = 'http://localhost:3001/api';

async function log(msg) {
    console.log(`\n🔹 ${msg}`);
}

async function runAdvancedValidation() {
    log("INITIALIZING ADVANCED E2E VALIDATION SUITE");
    let passed = 0;
    let failed = 0;

    const assert = (condition, message) => {
        if (condition) {
            console.log(`   ✅ PASS: ${message}`);
            passed++;
        } else {
            console.error(`   ❌ FAIL: ${message}`);
            failed++;
        }
    };

    try {
        // --- 1. Database & Seeding Verification ---
        log("1. DATABASE & SEEDING VERIFICATION");
        const dbPath = path.join(__dirname, 'ollamaclip.db');
        assert(fs.existsSync(dbPath), "SQLite database file 'ollamaclip.db' exists.");
        
        const workspacesPath = path.join(__dirname, 'Workspaces', 'My Global Workspace', 'Main Project');
        assert(fs.existsSync(workspacesPath), "Default 'Workspaces/My Global Workspace/Main Project' physical directories exist.");

        // --- 2. Agents Management Verification ---
        log("2. AGENT MANAGEMENT VERIFICATION");
        const testAgent = {
            id: `test-agent-${Date.now()}`,
            name: "QA Validation Bot",
            role: "Tester",
            model: "llama3",
            projectId: "default_project",
            systemPrompt: "You are a test."
        };

        const agentSaveRes = await fetch(`${API_BASE}/save-agent`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(testAgent)
        });
        const agentSaveData = await agentSaveRes.json();
        assert(agentSaveData.success, "Agent successfully saved via API.");

        const agentFilename = agentSaveData.filename;
        const agentFilePath = path.join(__dirname, 'Agent', agentFilename);
        assert(fs.existsSync(agentFilePath), `Agent Markdown file physically created at: ${agentFilename}`);

        // Note: SQLite agents_meta integrity is verified if deletion cascades or saves don't crash.

        // --- 3. Robust Task Management Verification ---
        log("3. TASK MANAGEMENT VERIFICATION");
        const taskId = `task-${Date.now()}`;
        
        // POST
        const taskCreateRes = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                id: taskId,
                title: "UI Rendering Engine Update",
                agentId: testAgent.id,
                projectId: "default_project",
                completed: false,
                status: "open"
            })
        });
        const taskCreateData = await taskCreateRes.json();
        assert(taskCreateData.success, "Task successfully created in SQLite.");

        // GET
        const tasksGetRes = await fetch(`${API_BASE}/tasks`);
        const tasks = await tasksGetRes.json();
        const foundTask = tasks.find(t => t.id === taskId);
        assert(foundTask && foundTask.title === "UI Rendering Engine Update", "Task retrieved successfully from GET /api/tasks.");
        assert(foundTask && foundTask.projectName === "Main Project", "Task GET query correctly joins 'projectName'.");

        // PUT
        const taskUpdateRes = await fetch(`${API_BASE}/tasks/${taskId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ completed: true, status: 'completed' })
        });
        const taskUpdateData = await taskUpdateRes.json();
        assert(taskUpdateData.success, "Task fully updated via PUT /api/tasks/:id.");

        const tasksGetRes2 = await fetch(`${API_BASE}/tasks`);
        const tasks2 = await tasksGetRes2.json();
        const updatedTask = tasks2.find(t => t.id === taskId);
        assert(updatedTask && updatedTask.completed === true, "Task completion state verified in database.");

        // --- 4. Agent Working Directories Verification ---
        log("4. AGENT WORKING DIRECTORIES VERIFICATION");
        const testFileName = `generated_${Date.now()}.md`;
        const testFileContent = "# Auto-Generated\nThis file was created during the E2E test.";
        
        const fileRes = await fetch(`${API_BASE}/workspace/file`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                filename: testFileName,
                content: testFileContent,
                workspaceName: "My Global Workspace",
                projectName: "Main Project"
            })
        });
        const fileData = await fileRes.json();
        assert(fileData.success, "Workspace file saving API responded with success.");
        
        const expectedFilePath = path.join(workspacesPath, testFileName);
        assert(fs.existsSync(expectedFilePath), `Physical file successfully created in nested Workspace/Project hierarchy: ${testFileName}`);

        const readContent = fs.readFileSync(expectedFilePath, 'utf-8');
        assert(readContent === testFileContent, "Physical file content matches exact payload written by Agent API.");

        // --- 5. CLEANUP ---
        log("5. SYSTEM CLEANUP");
        
        // Delete Task
        const taskDelRes = await fetch(`${API_BASE}/tasks/${taskId}`, { method: 'DELETE' });
        const taskDelData = await taskDelRes.json();
        assert(taskDelData.success, "Task successfully deleted.");
        
        // Delete Agent
        const agentDelRes = await fetch(`${API_BASE}/delete-agent`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ filename: agentFilename })
        });
        const agentDelData = await agentDelRes.json();
        assert(agentDelData.success, "Agent successfully deleted.");
        assert(!fs.existsSync(agentFilePath), "Agent Markdown file deleted from disk.");

        // Delete test generated file
        fs.unlinkSync(expectedFilePath);
        assert(!fs.existsSync(expectedFilePath), "Workspace generated file cleaned up.");

        log("========================================");
        console.log(`🎯 FINAL SCORE: ${passed} Passed | ${failed} Failed`);
        log("========================================");
        
        if (failed > 0) process.exit(1);

    } catch (e) {
        console.error("\n❌ FATAL EXCEPTION DURING TESTING:", e);
        process.exit(1);
    }
}

runAdvancedValidation();
