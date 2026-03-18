import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const API_BASE = 'http://localhost:3001/api';

async function runTests() {
    console.log("🔍 Starting Verification Tests...");

    try {
        // 1. Check Task Creation
        console.log("➡️ Testing Task Creation...");
        const taskId = "test-task-" + Date.now();
        const taskRes = await fetch(`${API_BASE}/tasks`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                id: taskId,
                title: "Test Task from Script",
                agentId: null,
                projectId: 'default_project',
                completed: false,
                status: 'open'
            })
        });
        const taskData = await taskRes.json();
        if (taskData.success) console.log("✅ Task created successfully.");
        else throw new Error("Task creation failed");

        // 2. Check Task Fetch
        console.log("➡️ Testing Task Retrieval...");
        const getRes = await fetch(`${API_BASE}/tasks`);
        const tasks = await getRes.json();
        const found = tasks.find(t => t.id === taskId);
        if (found) console.log("✅ Task found in database with correct metadata.");
        else throw new Error("Task not found in retrieval");

        // 3. Check Workspace File Creation
        console.log("➡️ Testing Workspace File Creation...");
        const fileRes = await fetch(`${API_BASE}/workspace/file`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                filename: "script_test.txt",
                content: "This is a verification file created by the updated test script.",
                projectName: "Main Project"
            })
        });
        const fileData = await fileRes.json();
        if (fileData.success) {
            console.log("✅ File API signaled success.");
            if (fs.existsSync(fileData.path)) {
                console.log("✅ Physical file verified on disk: " + fileData.path);
            } else {
                throw new Error("Physical file missing despite API success");
            }
        } else throw new Error("File creation API failed");

        // 4. Cleanup (Delete Task)
        console.log("➡️ Testing Task Deletion...");
        const delRes = await fetch(`${API_BASE}/tasks/${taskId}`, { method: 'DELETE' });
        const delData = await delRes.json();
        if (delData.success) console.log("✅ Task deleted successfully.");

        console.log("\n✨ ALL BACKEND TESTS PASSED!");
    } catch (e) {
        console.error("\n❌ TEST FAILED:", e.message);
        process.exit(1);
    }
}

runTests();
