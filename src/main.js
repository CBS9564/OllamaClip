import { fetchLocalModels } from './api/ollama.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderChat } from './ui/chat.js';
import { renderTasks } from './ui/tasks.js';
import { renderSettings } from './ui/settings.js';
import { renderModelsManager } from './ui/models.js';

// Application State
const appState = {
  activeView: 'dashboard',
  agents: [],
  localModels: [],
  isOllamaOnline: false,
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

  // 2. Load basic dummy agent if any (or leave empty)
  // Normally would load from localStorage
  const savedAgents = localStorage.getItem('ollamaclip_agents');
  if(savedAgents) {
      appState.agents = JSON.parse(savedAgents);
  }

  // 3. Bind Navigation
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
  btnNewAgent.addEventListener('click', openAgentWizard);

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
        // Reuse Dashboard for now for Agents view, real app would have specific list
      renderDashboard(contentContainer, appState.agents, appState.localModels, appState, updateView);
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

// Agent Wizard Modal (Prompt based for vanilla JS simplicity without huge DOM injections)
function openAgentWizard() {
    if (!appState.isOllamaOnline) {
        alert("Ollama is not running. Please start Ollama before creating an agent.");
        return;
    }

    const modelNames = appState.localModels.map(m => m.name).join('\n');
    
    setTimeout(() => {
        const name = prompt("Enter Agent Name (e.g., 'CTO', 'Copywriter'):", "New Agent");
        if (!name) return;

        const role = prompt("Enter Agent Role (e.g., 'Lead Developer'):", "Assistant");
        if (!role) return;

        let model = prompt(`Available Models:\n${modelNames}\n\nEnter exact model name:`, appState.localModels[0]?.name || "");
        if (!model) return;

        const systemPrompt = prompt("System Prompt (Instructions):", `You are ${name}, acting as the ${role}. Provide highly professional and concise answers.`);
        if(!systemPrompt) return;

        // Save Agent
        const newAgent = {
            id: Date.now().toString(),
            name,
            role,
            model,
            systemPrompt,
            color: colors[appState.agents.length % colors.length]
        };

        appState.agents.push(newAgent);
        localStorage.setItem('ollamaclip_agents', JSON.stringify(appState.agents));
        
        updateView(); // Re-render current view
    }, 100);
}

// Boot
init();
