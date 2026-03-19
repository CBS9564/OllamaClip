async function testAPI() {
    const baseUrl = 'http://localhost:3001/api';
    
    console.log('--- Testing Project Context ---');
    const pName = 'Verify Project ' + Date.now();
    const pRes = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pName, context: 'Project Objective' })
    });
    const pData = await pRes.json();
    
    const pListRes = await fetch(`${baseUrl}/projects`);
    const pList = await pListRes.json();
    const createdProject = pList.find(p => p.id === pData.id);
    console.log('Project fetched:', createdProject);

    console.log('\n--- Testing Task Context ---');
    const tId = 'test_t_' + Date.now();
    const tRes = await fetch(`${baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            id: tId, 
            title: 'Verify Task', 
            context: 'Task Detail',
            projectId: pData.id
        })
    });
    
    const tListRes = await fetch(`${baseUrl}/tasks`);
    const tList = await tListRes.json();
    const createdTask = tList.find(t => t.id === tId);
    console.log('Task fetched:', createdTask);

    if (createdTask && createdTask.context === 'Task Detail') {
        console.log('✅ Task Context Presence Verified');
    } else {
        console.log('❌ Task Context Presence Failed');
    }

    if (createdTask && createdTask.projectContext === 'Project Objective') {
        console.log('✅ Joined Project Context Verified');
    } else {
        console.log('❌ Joined Project Context Failed (Recv: ' + (createdTask ? createdTask.projectContext : 'null') + ')');
    }
}

testAPI();
