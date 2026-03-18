import { setOllamaConfig } from '../api/ollama.js';

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

    // Initialize values from global state (DB-backed) or defaults
    inputApiUrl.value = appState.settings?.ollamaclip_api_url || 'http://localhost:11434/api';
    selectKeepAlive.value = appState.settings?.ollamaclip_keep_alive || '5m';

    // Save Configuration
    btnSave.addEventListener('click', async () => {
        const newUrl = inputApiUrl.value.trim();
        const newKeepAlive = selectKeepAlive.value;
        const payload = {};
        
        if (newUrl) payload.ollamaclip_api_url = newUrl;
        if (newKeepAlive) payload.ollamaclip_keep_alive = newKeepAlive;

        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Saving...';

        try {
            const res = await fetch(`${appState.backendUrl}/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (res.ok) {
                appState.settings = { ...appState.settings, ...payload };
                appState.apiUrl = appState.settings.ollamaclip_api_url;
                appState.keepAlive = appState.settings.ollamaclip_keep_alive;
                setOllamaConfig(appState.apiUrl, appState.keepAlive);
                
                // Show feedback
                feedback.style.color = "var(--text-primary)";
                feedback.textContent = "Saved securely to database!";
                feedback.style.opacity = '1';
                setTimeout(() => feedback.style.opacity = '0', 2000);
            } else {
                alert("Failed to save settings.");
            }
        } catch(e) {
            alert("Error communicating with settings API");
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="ph ph-floppy-disk"></i> Save Configuration';
        }
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
