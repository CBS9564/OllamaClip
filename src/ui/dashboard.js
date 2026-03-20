import { pullModel, deleteModel, fetchLocalModels } from '../api/ollama.js';

export function renderDashboard(container, agents, localModels, appStateRef, updateViewCallback) {
  const tpl = document.getElementById('tpl-dashboard');
  const clone = tpl.content.cloneNode(true);
  
  // 1. Update Stats Function
  const updateStats = () => {
      const statAgents = container.querySelector('#stat-active-agents');
      const statModels = container.querySelector('#stat-local-models');
      const agentsCount = appStateRef.agents.filter(a => !appStateRef.activeProjectId || a.projectId === appStateRef.activeProjectId).length;
      
      if (statAgents) statAgents.textContent = agentsCount;
      if (statModels) {
          if (localModels) {
              statModels.textContent = localModels.length;
          } else {
              statModels.textContent = "Offline";
              statModels.style.color = "var(--danger)";
          }
      }
  };

  // 2. Hierarchical Org Chart Functions
  const buildAgentTree = (flatAgents) => {
      const map = {};
      const roots = [];
      
      // Initialize map
      flatAgents.forEach(a => {
          map[a.id] = { ...a, children: [] };
      });
      
      // Build tree
      flatAgents.forEach(a => {
          if (a.parentId && map[a.parentId]) {
              map[a.parentId].children.push(map[a.id]);
          } else {
              // If no parent or parent not in this project, it's a root
              roots.push(map[a.id]);
          }
      });
      
      return roots;
  };

  const renderNode = (node) => {
      const nodeEl = document.createElement('div');
      nodeEl.className = 'org-node';
      
      const hasChildren = node.children && node.children.length > 0;
      if (hasChildren) {
          nodeEl.classList.add('has-children');
      }

      const card = document.createElement('div');
      card.className = 'agent-card glass-panel small-card';
      card.style.borderTop = `3px solid ${node.color || 'var(--accent-primary)'}`;
      card.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
              <i class="ph-fill ph-robot" style="color: ${node.color || 'var(--accent-primary)'}; font-size: 0.9rem;"></i>
              <strong style="font-size: 0.85rem; white-space: nowrap;">${node.name}</strong>
          </div>
          <div style="font-size: 0.65rem; color: var(--text-secondary); text-transform: uppercase;">${node.role}</div>
      `;
      nodeEl.appendChild(card);
      
      if (node.children && node.children.length > 0) {
          const childrenContainer = document.createElement('div');
          childrenContainer.className = 'org-children';
          node.children.forEach(child => {
              childrenContainer.appendChild(renderNode(child));
          });
          nodeEl.appendChild(childrenContainer);
      }
      
      return nodeEl;
  };

  const updateOrgChart = () => {
      const orgChartContainer = container.querySelector('#org-chart-container');
      if (!orgChartContainer) return;
      
      const projectAgents = appStateRef.agents.filter(a => !appStateRef.activeProjectId || a.projectId === appStateRef.activeProjectId);
      
      if (projectAgents.length > 0) {
          orgChartContainer.innerHTML = ''; 
          
          const treeRoots = buildAgentTree(projectAgents);
          const treeWrapper = document.createElement('div');
          treeWrapper.className = 'org-tree-wrapper';
          
          treeRoots.forEach(root => {
              treeWrapper.appendChild(renderNode(root));
          });
          
          orgChartContainer.appendChild(treeWrapper);
      } else {
          orgChartContainer.innerHTML = '<p class="empty-msg">No agents in this project context.</p>';
      }
  };

  // Click on "Available Models" to switch to Models view
  const btnShowModelManager = clone.querySelector('#btn-show-model-manager');
  if (btnShowModelManager) {
      btnShowModelManager.addEventListener('click', () => {
          appStateRef.activeView = 'models';
          updateViewCallback();
      });
  }

  // Click on "Active Agents" to switch to Agents view
  const statCardAgents = container.querySelector('.stat-card:first-child');
  if (statCardAgents) {
      statCardAgents.style.cursor = 'pointer';
      statCardAgents.title = 'Click to manage agents';
      statCardAgents.addEventListener('click', () => {
          appStateRef.activeView = 'agents';
          updateViewCallback();
      });
  }

  // Initial render setup
  container.innerHTML = '';
  container.appendChild(clone);
  
  // Real-time updates
  updateStats();
  updateOrgChart();

  // Listen for changes
  const onUpdate = () => {
      updateStats();
      updateOrgChart();
  };
  window.addEventListener('ollamaclip_agents_updated', onUpdate);
  window.addEventListener('ollamaclip_context_changed', onUpdate);
}
