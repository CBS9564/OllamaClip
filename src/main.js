import { fetchLocalModels } from './api/ollama.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderChat } from './ui/chat.js';
import { renderTasks } from './ui/tasks.js';
import { renderSettings } from './ui/settings.js';
import { renderModelsManager } from './ui/models.js';
import { renderAgents } from './ui/agents.js';
import { HeartbeatManager } from './api/heartbeat.js';

// Application State
const appState = {
  activeView: 'dashboard',
  agents: [],
  localModels: [],
  isOllamaOnline: false,
  editingAgentId: null,
  backendUrl: 'http://localhost:3001/api',
  heartbeat: null
};

// Colors for agents
const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6'];

// DOM Elements
const contentContainer = document.getElementById('content-container');
const pageTitle = document.getElementById('page-title');
const navItems = document.querySelectorAll('.nav-item');
const statusIndicator = document.querySelector('.status-indicator');
const btnNewAgent = document.getElementById('btn-new-agent');

// Initialize App
async function init() {
  // 1. Check Ollama Status & Get Models
  try {
    const models = await fetchLocalModels();
    if (models && models.length > 0) {
      appState.localModels = models;
      appState.isOllamaOnline = true;
      statusIndicator.classList.add('online');
      statusIndicator.querySelector('span:last-child').textContent = 'Ollama Connected';
    } else {
      throw new Error("No models");
    }
  } catch(e) {
    statusIndicator.classList.remove('online');
    statusIndicator.querySelector('span:last-child').textContent = 'Ollama Offline';
  }

  // 2. Sync with Filesystem (Source of Truth)
  await syncAgentsWithFileSystem();

  // 3. Initialize Heartbeat (Autonomous Mode)
  appState.heartbeat = new HeartbeatManager(() => appState.agents, (agent, message) => {
      console.log(`[PROACTIVE] ${agent.name}: ${message}`);
      
      // Save proactive message to shared workspace
      const history = JSON.parse(localStorage.getItem('ollamaclip_shared_workspace') || '[]');
      history.push({
          role: 'assistant',
          content: message,
          agentName: agent.name,
          agentColor: agent.color,
          isProactive: true // Metadata to distinguish autonomous thoughts
      });
      localStorage.setItem('ollamaclip_shared_workspace', JSON.stringify(history));
      
      // Notify components (Chat UI mainly)
      window.dispatchEvent(new CustomEvent('ollamaclip_new_message', { 
          detail: { agent, message } 
      }));
  });
  appState.heartbeat.start();

  // 4. Bind Navigation
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // Find parent button if icon is clicked
      const btn = e.target.closest('button');
      if(!btn || !btn.dataset.target) return;
      
      navItems.forEach(nav => nav.classList.remove('active'));
      btn.classList.add('active');
      
      const target = btn.dataset.target;
      appState.activeView = target;
      
      updateView();
    });
  });

  // 4. Bind New Agent Button
  btnNewAgent.addEventListener('click', () => openAgentWizard());

  // 5. Initial Render
  updateView();
}

// Router/View Manager
function updateView() {
  pageTitle.textContent = appState.activeView.charAt(0).toUpperCase() + appState.activeView.slice(1);
  
  // Manage Add button visibility based on view
  if(appState.activeView === 'dashboard' || appState.activeView === 'agents') {
      btnNewAgent.style.display = 'inline-flex';
  } else {
      btnNewAgent.style.display = 'none';
  }

  switch(appState.activeView) {
    case 'dashboard':
      renderDashboard(contentContainer, appState.agents, appState.localModels, appState, updateView);
      break;
    case 'chat':
      pageTitle.textContent = 'Inbox';
      renderChat(contentContainer, appState.agents);
      break;
    case 'agents':
      renderAgents(
          contentContainer, 
          appState.agents, 
          (id) => openAgentWizard(id), // Edit callback
          (id) => deleteAgent(id)      // Delete callback
      );
      break;
    case 'tasks':
      pageTitle.textContent = 'Workflow Tasks';
      renderTasks(contentContainer, appState.agents);
      break;
    case 'models':
      pageTitle.textContent = 'Model Library';
      renderModelsManager(contentContainer, appState, updateView);
      break;
    case 'settings':
      pageTitle.textContent = 'Preferences & Configuration';
      renderSettings(contentContainer, appState);
      break;
    default:
      contentContainer.innerHTML = '<div style="padding: 24px;">View not implemented yet.</div>';
  }
}

// Agent Builder Modal Logic
const modalOverlay = document.getElementById('agent-modal-overlay');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const btnSaveAgent = document.getElementById('btn-save-agent');
const tempInput = document.getElementById('agent-temperature');
const tempValDisplay = document.getElementById('temp-val');

// Update temperature display
if(tempInput && tempValDisplay) {
    tempInput.addEventListener('input', (e) => {
        tempValDisplay.textContent = e.target.value;
    });
}

function openAgentWizard(agentId = null) {
    if (!appState.isOllamaOnline || appState.localModels.length === 0) {
        alert("Ollama is not running or no models are installed. Please start Ollama before creating an agent.");
        return;
    }

    appState.editingAgentId = agentId;
    const isEditing = !!agentId;
    const agent = isEditing ? appState.agents.find(a => a.id === agentId) : null;

    document.getElementById('modal-title').textContent = isEditing ? 'Edit Agent' : 'Create New Agent';

    // Populate model dropdown
    const modelSelect = document.getElementById('agent-model');
    modelSelect.innerHTML = appState.localModels.map(m => 
        `<option value="${m.name}">${m.name} (${formatBytes(m.size)})</option>`
    ).join('');

    // Update Form fields
    document.getElementById('agent-name').value = agent?.name || '';
    document.getElementById('agent-role').value = agent?.role || '';
    document.getElementById('agent-prompt').value = agent?.systemPrompt || '';
    document.getElementById('agent-color').value = agent?.color || '#6366f1';
    document.getElementById('agent-temperature').value = agent?.options?.temperature ?? 0.7;
    document.getElementById('temp-val').textContent = agent?.options?.temperature ?? '0.7';
    document.getElementById('agent-context').value = agent?.options?.num_ctx || '2048';

    modalOverlay.classList.add('active');
}

async function deleteAgent(id) {
    const agent = appState.agents.find(a => a.id === id);
    if (!agent) return;

    // 1. Local State
    appState.agents = appState.agents.filter(a => a.id !== id);
    localStorage.setItem('ollamaclip_agents', JSON.stringify(appState.agents));
    
    // 2. Physical File
    try {
        await fetch(`${appState.backendUrl}/delete-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: agent.name, 
                role: agent.role,
                filename: agent.filename 
            })
        });
    } catch(e) {
        console.warn("Failed to delete physical file:", e);
    }

    updateView();
}

async function syncAgentsWithFileSystem() {
    // 1. Load from localStorage as fallback
    const savedAgents = localStorage.getItem('ollamaclip_agents');
    if(savedAgents) {
        appState.agents = JSON.parse(savedAgents);
    }

    try {
        const response = await fetch(`${appState.backendUrl}/load-agents`);
        if (response.ok) {
            const physicalAgents = await response.json();
            
            if (physicalAgents && physicalAgents.length > 0) {
                // If we have physical agents, they take priority
                appState.agents = physicalAgents;
                localStorage.setItem('ollamaclip_agents', JSON.stringify(appState.agents));
            } else if (appState.agents.length > 0) {
                // MIGRATION: If physical is empty but we have local agents, 
                // push them to the backend to create the files
                console.log("[Persistence] Migrating local agents to physical files...");
                for (const agent of appState.agents) {
                    // Safety: Valid ID check
                    if (!agent.id || agent.id === 'undefined' || agent.id === 'null') {
                        agent.id = "agent-" + Date.now().toString();
                    }
                    console.log(`[Persistence] Migrating ${agent.name}...`);
                    fetch(`${appState.backendUrl}/save-agent`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(agent)
                    }).catch(e => console.warn("Migration failed for:", agent.name, e));
                }
            }
        }
    } catch(e) {
        console.warn("Backend bridge not running. Staying in Local-Only mode.");
    }
}

function closeAgentWizard() {
    modalOverlay.classList.remove('active');
}

if(btnCloseModal) btnCloseModal.addEventListener('click', closeAgentWizard);
if(btnCancelModal) btnCancelModal.addEventListener('click', closeAgentWizard);

if(btnSaveAgent) {
    btnSaveAgent.addEventListener('click', () => {
        const name = document.getElementById('agent-name').value.trim();
        const role = document.getElementById('agent-role').value.trim();
        const model = document.getElementById('agent-model').value;
        const color = document.getElementById('agent-color').value;
        const systemPrompt = document.getElementById('agent-prompt').value.trim();
        const temperature = parseFloat(document.getElementById('agent-temperature').value);
        const numCtx = parseInt(document.getElementById('agent-context').value);

        if(!name || !role || !systemPrompt) {
            alert("Please fill in all required fields (Name, Role, Prompt).");
            return;
        }

        const agentData = {
            name,
            role,
            model,
            systemPrompt,
            color,
            options: {
                temperature: temperature,
                num_ctx: numCtx
            }
        };

        // State Update
        let targetAgent;
        if (appState.editingAgentId) {
            const index = appState.agents.findIndex(a => a.id === appState.editingAgentId);
            if (index !== -1) {
                appState.agents[index] = { ...appState.agents[index], ...agentData };
                targetAgent = appState.agents[index];
            }
        } else {
            targetAgent = {
                id: "agent-" + Date.now().toString(),
                ...agentData
            };
            appState.agents.push(targetAgent);
        }

        console.log("[State] Saving agent to memory:", targetAgent);

        // 1. Persistence - Local
        localStorage.setItem('ollamaclip_agents', JSON.stringify(appState.agents));

        // 2. Persistence - Physical (Internal Bridge)
        if (targetAgent) {
            fetch(`${appState.backendUrl}/save-agent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(targetAgent)
            })
            .then(res => res.json())
            .then(data => console.log("[Persistence] Physical sync successful:", data.filename))
            .catch(e => console.error("[Persistence] Physical sync failed:", e));
        }

        // 3. UI Update
        closeAgentWizard();
        appState.editingAgentId = null; 
        updateView();
    });
}

// Utility function to format bytes for the dropdown
function formatBytes(bytes, decimals = 1) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Boot
init();
