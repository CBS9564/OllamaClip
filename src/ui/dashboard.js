import { pullModel, deleteModel, fetchLocalModels } from '../api/ollama.js';

export function renderDashboard(container, agents, localModels, appStateRef, updateViewCallback) {
  const tpl = document.getElementById('tpl-dashboard');
  const clone = tpl.content.cloneNode(true);
  
  // Update stats
  const statAgents = clone.querySelector('#stat-active-agents');
  const statModels = clone.querySelector('#stat-local-models');
  
  if (statAgents) statAgents.textContent = agents.length;
  if (statModels) {
      if (localModels) {
          statModels.textContent = localModels.length;
      } else {
          statModels.textContent = "Error/Offline";
          statModels.style.color = "var(--danger)";
      }
  }

  // Update Org Chart
  const orgChartContainer = clone.querySelector('#org-chart-container');
  if (agents.length > 0 && orgChartContainer) {
      orgChartContainer.innerHTML = ''; // Clear empty state
      
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
      grid.style.gap = '16px';
      grid.style.width = '100%';
      
      agents.forEach(agent => {
          const card = document.createElement('div');
          card.className = 'agent-card glass-panel';
          card.style.padding = '16px';
          card.style.display = 'flex';
          card.style.flexDirection = 'column';
          card.style.gap = '8px';
          card.style.borderTop = `4px solid ${agent.color || 'var(--accent-primary)'}`;
          
          card.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <strong>${agent.name}</strong>
                <i class="ph-fill ph-robot" style="color: ${agent.color || 'var(--accent-primary)'}"></i>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">
                ${agent.role}
            </div>
            <div style="margin-top: 8px; font-size: 0.75rem; background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px;">
                Model: ${agent.model}
            </div>
          `;
          grid.appendChild(card);
      });
      orgChartContainer.appendChild(grid);
  }

  // Click on "Available Models" to switch to Models view
  const btnShowModelManager = clone.querySelector('#btn-show-model-manager');
  if (btnShowModelManager) {
      btnShowModelManager.addEventListener('click', () => {
          appStateRef.activeView = 'models';
          updateViewCallback();
      });
  }

  // Click on "Active Agents" to switch to Agents view
  const statCardAgents = clone.querySelector('.stat-card:first-child');
  if (statCardAgents) {
      statCardAgents.style.cursor = 'pointer';
      statCardAgents.title = 'Click to manage agents';
      statCardAgents.addEventListener('click', () => {
          appStateRef.activeView = 'agents';
          updateViewCallback();
      });
  }

  container.innerHTML = '';
  container.appendChild(clone);
}
