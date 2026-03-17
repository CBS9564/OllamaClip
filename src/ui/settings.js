export function renderSettings(container, appState) {
    const tpl = document.getElementById('tpl-settings');
    const clone = tpl.content.cloneNode(true);
    container.innerHTML = '';
    
    // Elements
    const inputApiUrl = clone.querySelector('#setting-api-url');
    const selectKeepAlive = clone.querySelector('#setting-keep-alive');
    const btnSave = clone.querySelector('#btn-save-settings');
    const feedback = clone.querySelector('#settings-save-feedback');
    
    const btnClearWorkspace = clone.querySelector('#btn-clear-workspace');
    const btnClearTasks = clone.querySelector('#btn-clear-tasks');
    const btnDeleteAgents = clone.querySelector('#btn-delete-agents');

    // Initialize values from local storage or defaults
    inputApiUrl.value = localStorage.getItem('ollamaclip_api_url') || 'http://localhost:11434/api';
    selectKeepAlive.value = localStorage.getItem('ollamaclip_keep_alive') || '5m';

    // Save Configuration
    btnSave.addEventListener('click', () => {
        const newUrl = inputApiUrl.value.trim();
        const newKeepAlive = selectKeepAlive.value;

        if (newUrl) {
            localStorage.setItem('ollamaclip_api_url', newUrl);
            appState.apiUrl = newUrl; // Update global state
        }
        
        localStorage.setItem('ollamaclip_keep_alive', newKeepAlive);
        appState.keepAlive = newKeepAlive; // Update global state
        
        // Show feedback
        feedback.style.opacity = '1';
        setTimeout(() => feedback.style.opacity = '0', 2000);
    });

    // Data Management Actions
    btnClearWorkspace.addEventListener('click', () => {
        if (confirm("Are you sure you want to clear the Shared Workspace chat history? This cannot be undone.")) {
            localStorage.removeItem('ollamaclip_shared_workspace');
            alert("Shared Workspace cleared.");
        }
    });

    btnClearTasks.addEventListener('click', () => {
        if (confirm("Are you sure you want to delete ALL tasks (open and completed)?")) {
            localStorage.removeItem('ollamaclip_tasks');
            alert("All tasks deleted.");
        }
    });

    btnDeleteAgents.addEventListener('click', () => {
        if (confirm("WARNING: This will delete ALL your configured agents. Are you absolutely sure?")) {
            localStorage.removeItem('ollamaclip_agents');
            // Also clean up individual agent chat histories just in case V2 data lingers
            appState.agents.forEach(agent => {
                localStorage.removeItem(`ollamaclip_chat_${agent.id}`);
            });
            
            appState.agents = [];
            alert("All agents deleted. The application will now reload.");
            window.location.reload();
        }
    });

    container.appendChild(clone);
}
