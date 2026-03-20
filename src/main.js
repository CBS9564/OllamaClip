import { fetchLocalModels, setOllamaConfig } from './api/ollama.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderChat } from './ui/chat.js';
import { renderTasks } from './ui/tasks.js';
import { renderSettings } from './ui/settings.js';
import { renderModelsManager } from './ui/models.js';
import { renderAgents } from './ui/agents.js';
import { renderProjects } from './ui/projects.js';
import { HeartbeatManager } from './api/heartbeat.js';

// Application State
const appState = {
  activeView: 'dashboard',
  agents: [],
  tasks: [], // Centralized tasks
  localModels: [],
  projects: [],
  activeProjectId: null,
  activeProjectName: "Global Context",
  isOllamaOnline: false,
  editingAgentId: null,
  backendUrl: 'http://localhost:3001/api',
  heartbeat: null,
  activeTaskId: null,
  editingTaskId: null
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
  // 0. Fetch Settings
  try {
      const sRes = await fetch(`${appState.backendUrl}/settings`);
      if(sRes.ok) {
          appState.settings = await sRes.json();
          setOllamaConfig(appState.settings.ollamaclip_api_url, appState.settings.ollamaclip_keep_alive);
          appState.apiUrl = appState.settings.ollamaclip_api_url || 'http://localhost:11434/api';
          appState.keepAlive = appState.settings.ollamaclip_keep_alive || '5m';
      } else {
          appState.settings = {};
      }
  } catch(e) { 
      console.error("Could not load settings", e); 
      appState.settings = {};
  }

  // Sidebar Unread Badge Logic (needed by fetchTasks)
  const updateSidebarUnreads = () => {
      const inboxBtn = document.querySelector('.nav-item[data-target="chat"]');
      if (!inboxBtn) return;
      
      const unreads = JSON.parse(localStorage.getItem('ollamaclip_unreads_tasks') || '{}');
      let total = 0;
      const projectTasks = (appState.tasks || []).filter(t => String(t.projectId) === String(appState.activeProjectId));
      const validIdsForCurrentView = [
          ...projectTasks.map(t => String(t.id)),
          `project_${appState.activeProjectId}`
      ];
      
      const allValidTaskIds = (appState.tasks || []).map(t => String(t.id));
      const allValidProjectIds = (appState.projects || []).map(p => `project_${p.id}`);

      Object.keys(unreads).forEach(id => {
          if (validIdsForCurrentView.includes(String(id))) {
              total += unreads[id];
          } else if (!allValidTaskIds.includes(String(id)) && !allValidProjectIds.includes(String(id))) {
              delete unreads[id];
          }
      });
      localStorage.setItem('ollamaclip_unreads_tasks', JSON.stringify(unreads));
      
      let badge = inboxBtn.querySelector('.unread-badge');
      if (total > 0) {
          if (!badge) {
              badge = document.createElement('span');
              badge.className = 'unread-badge';
              badge.style.marginLeft = 'auto';
              inboxBtn.appendChild(badge);
          }
          badge.textContent = total > 99 ? '99+' : total;
      } else if (badge) {
          badge.remove();
      }
  };
  window.addEventListener('ollamaclip_unread_updated', updateSidebarUnreads);

  async function fetchTasks() {
      try {
          const res = await fetch(`${appState.backendUrl}/tasks`);
          if (res.ok) {
              appState.tasks = await res.json();
              updateSidebarUnreads();
          }
      } catch (e) {
          console.error("fetchTasks error:", e);
      }
  }
  window.fetchTasks = fetchTasks;

  window.addEventListener('ollamaclip_tasks_updated', () => {
      fetchTasks().then(() => {
          // No force update needed; components like tasks.js or dashboard handle this internally
          // or will be fresh when we switch to them.
          updateView(); 
      });
  });

  window.addEventListener('ollamaclip_agents_updated', () => {
      // If we are on a view that shows agents, refresh it
      if (['agents', 'dashboard', 'chat'].includes(appState.activeView)) {
          updateView();
      }
  });

  window.addEventListener('ollamaclip_projects_updated', () => {
      // Refresh project list if on projects view
      if (appState.activeView === 'projects') {
          updateView();
      }
  });

  window.addEventListener('ollamaclip_context_changed', () => {
      // Context change is a major event, we might want to force a full re-render
      // to ensure all internal state of components is reset correctly.
      updateView(true);
  });

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

  // 2. Fetch Projects & Tasks
  try {
     const pRes = await fetch(`${appState.backendUrl}/projects`);
     if(pRes.ok) appState.projects = await pRes.json();
     
     if(appState.projects.length > 0) {
         appState.activeProjectId = appState.projects[0].id;
         appState.activeProjectName = appState.projects[0].name;
     }

     await fetchTasks();
  } catch(e) { console.error("Could not load projects/tasks", e); }
  
  // 3. Sync with Filesystem (Source of Truth)
  await syncAgentsWithFileSystem();

  // 4. Initialize Heartbeat (Autonomous Mode)
  appState.heartbeat = new HeartbeatManager(
      () => appState.agents, 
      (detail) => {
          if (window._onChatUpdate) {
              window._onChatUpdate(detail);
          }
          
          if (appState.activeView !== 'chat') {
              const unreads = JSON.parse(localStorage.getItem('ollamaclip_unreads_tasks') || '{}');
              unreads[detail.taskId] = (unreads[detail.taskId] || 0) + 1;
              localStorage.setItem('ollamaclip_unreads_tasks', JSON.stringify(unreads));
              window.dispatchEvent(new CustomEvent('ollamaclip_unread_updated'));
          }
      }
  );
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

  // Bind New Agent Button
  btnNewAgent.addEventListener('click', () => openAgentWizard());

  // 5. Global Thinking Indicator (Red Brain)
  const thinkingIndicator = document.getElementById('global-thinking');
  window.addEventListener('ollama_thinking_start', () => {
      thinkingIndicator?.classList.add('active');
  });
  window.addEventListener('ollama_thinking_stop', () => {
      thinkingIndicator?.classList.remove('active');
  });

  // Initial Render
  updateView();
}

// Removed Workspace & Project Dropdown Logic from Header since we use dedicated page

// Router/View Manager
let lastRenderedView = null;

function updateView(force = false) {
  if (lastRenderedView === appState.activeView && !force) {
      console.log(`[UI] Skipping redundant render for view: ${appState.activeView}`);
      return;
  }
  lastRenderedView = appState.activeView;
  
  pageTitle.textContent = appState.activeView.charAt(0).toUpperCase() + appState.activeView.slice(1);
  
  if(appState.activeView === 'dashboard' || appState.activeView === 'agents') {
      btnNewAgent.style.display = 'inline-flex';
  } else {
      btnNewAgent.style.display = 'none';
  }

  const projectAgents = appState.agents.filter(a => !appState.activeProjectId || a.projectId === appState.activeProjectId);

  switch(appState.activeView) {
    case 'dashboard':
      renderDashboard(contentContainer, projectAgents, appState.localModels, appState, () => updateView(true));
      break;
    case 'projects':
      pageTitle.textContent = 'Projects';
      renderProjects(contentContainer, appState, () => updateView(true));
      break;
    case 'chat':
      pageTitle.textContent = 'Inbox';
      renderChat(contentContainer, projectAgents, appState);
      break;
    case 'agents':
      renderAgents(
          contentContainer, 
          projectAgents, 
          (id) => openAgentWizard(id),
          (id) => deleteAgent(id)
      );
      break;
    case 'tasks':
      pageTitle.textContent = 'Workflow Tasks';
      renderTasks(contentContainer, projectAgents, appState.activeProjectId, appState);
      break;
    case 'models':
      pageTitle.textContent = 'Model Library';
      renderModelsManager(contentContainer, appState, () => updateView(true));
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

    // 1. Local State (Immediate UI Feedback)
    appState.agents = appState.agents.filter(a => a.id !== id);
    localStorage.setItem('ollamaclip_agents', JSON.stringify(appState.agents));
    window.dispatchEvent(new CustomEvent('ollamaclip_agents_updated'));
    
    // 2. Physical File
    try {
        await fetch(`${appState.backendUrl}/delete-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                id: id,
                filename: agent.filename 
            })
        });
    } catch(e) {
        console.warn("[Persistence] Deletion request failed:", e);
    }
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
            } else {
                // If backend is empty, we should also clear local state to stay in sync
                appState.agents = [];
                localStorage.setItem('ollamaclip_agents', JSON.stringify([]));
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
            projectId: appState.activeProjectId,
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

        // 1. Persistence - Local
        localStorage.setItem('ollamaclip_agents', JSON.stringify(appState.agents));
        window.dispatchEvent(new CustomEvent('ollamaclip_agents_updated'));

        // 2. Persistence - Physical (Internal Bridge)
        if (targetAgent) {
            fetch(`${appState.backendUrl}/save-agent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(targetAgent)
            })
            .then(res => res.json())
            .then(data => {
                if (data.success && data.filename) {
                    targetAgent.filename = data.filename;
                    localStorage.setItem('ollamaclip_agents', JSON.stringify(appState.agents));
                    // No need for a 2nd event if name/role didn't change, but keep it for sync
                    window.dispatchEvent(new CustomEvent('ollamaclip_agents_updated'));
                }
            })
            .catch(e => console.error("[Persistence] Physical sync failed:", e));
        }

        // 3. UI Update
        closeAgentWizard();
        appState.editingAgentId = null; 
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
