import { showModal, showToast } from './utils.js';

const API_URL = 'http://localhost:3001/api';

export function renderTasks(container, agents, activeProjectId, appState) {
  const tpl = document.getElementById('tpl-tasks');
  const clone = tpl.content.cloneNode(true);
  container.innerHTML = '';
  
  const titleInput = clone.querySelector('#task-title-input');
  const agentSelect = clone.querySelector('#task-agent-select');
  const btnAddTask = clone.querySelector('#btn-add-task');
  const openTaskList = clone.querySelector('#open-task-list');
  const completedTaskList = clone.querySelector('#completed-task-list');
  
  const contextInput = clone.querySelector('#task-context-input');
  
  // Use persistent state
  let editingTaskId = appState.editingTaskId || null;

  // Populate Select
  agents.forEach(agent => {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = agent.name;
      agentSelect.appendChild(opt);
  });

  const getAgentInfo = (agentId) => {
      const ag = agents.find(a => a.id === agentId);
      return ag ? { name: ag.name, color: ag.color } : { name: 'Unassigned', color: 'var(--text-muted)' };
  };

  const renderList = async () => {
      // Use centralized appState.tasks if available, or fetch
      if (typeof window.fetchTasks === 'function') {
          await window.fetchTasks();
      }
      
      const allTasks = appState.tasks || [];
      openTaskList.innerHTML = '';
      completedTaskList.innerHTML = '';

      const filteredTasks = allTasks.filter(t => !activeProjectId || t.projectId === activeProjectId);
      const openTasks = filteredTasks.filter(t => !t.completed);
      const completedTasks = filteredTasks.filter(t => t.completed);

      if (openTasks.length === 0) {
          openTaskList.innerHTML = '<li class="empty-msg" style="color:var(--text-muted); font-size:0.85rem; padding: 10px;">No open tasks.</li>';
      }
      
      if (completedTasks.length === 0) {
          completedTaskList.innerHTML = '<li class="empty-msg" style="color:var(--text-muted); font-size:0.85rem; padding: 10px;">No completed tasks yet.</li>';
      }

      filteredTasks.forEach(task => { // Use filteredTasks here!
          const li = document.createElement('li');
          const isEditing = task.id === editingTaskId;
          li.className = `task-item ${isEditing ? 'editing' : ''}`;
          
          const agentInfo = getAgentInfo(task.agentId);
          
          if (isEditing) {
              li.innerHTML = `
                  <div class="task-edit-form" style="display:flex; flex-direction:column; gap:8px; width:100%;">
                      <input type="text" class="edit-task-title" value="${task.title}" style="width:100%;" />
                      <textarea class="edit-task-context" style="width:100%; height:60px; resize:none;">${task.context || ''}</textarea>
                      <div style="display:flex; gap:8px;">
                          <select class="edit-task-agent" style="flex:1;">
                              <option value="">Unassigned</option>
                              ${agents.map(a => `<option value="${a.id}" ${a.id === task.agentId ? 'selected' : ''}>${a.name}</option>`).join('')}
                          </select>
                          <button class="btn btn-primary btn-sm btn-save-edit"><i class="ph ph-check"></i></button>
                          <button class="btn btn-secondary btn-sm btn-cancel-edit"><i class="ph ph-x"></i></button>
                      </div>
                  </div>
              `;
              
              li.querySelector('.btn-save-edit').addEventListener('click', async () => {
                  const newTitle = li.querySelector('.edit-task-title').value.trim();
                  const newContext = li.querySelector('.edit-task-context').value.trim();
                  const newAgentId = li.querySelector('.edit-task-agent').value || null;
                  
                  await fetch(`${API_URL}/tasks/${task.id}`, {
                      method: 'PUT',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({ title: newTitle, context: newContext, agentId: newAgentId })
                  });
                  
                  editingTaskId = null;
                  renderList();
              });
              
              li.querySelector('.btn-cancel-edit').addEventListener('click', () => {
                  editingTaskId = null;
                  appState.editingTaskId = null; // Persist
                  renderList();
              });
          } else {
              li.innerHTML = `
                  <div class="task-checkbox ${task.completed ? 'checked' : ''}"></div>
                  <div class="task-content">
                      <span class="task-title">${task.title}</span>
                      ${task.context ? `<p style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">${task.context}</p>` : ''}
                      <div class="task-meta">
                          <span class="task-agent" style="background: ${agentInfo.color}20; color: ${agentInfo.color}">
                              <i class="ph-fill ph-robot"></i> ${agentInfo.name}
                          </span>
                          <span style="color: var(--text-muted)">Created ${new Date(task.createdAt).toLocaleDateString()}</span>
                      </div>
                  </div>
                  <div class="task-actions" style="display:flex; gap:8px; align-items:center;">
                      ${!task.completed ? `
                        <button class="task-control play ${task.heartbeat && task.status === 'processing' ? 'active' : ''}" title="Play (Start Heartbeat)">
                            <i class="ph-fill ph-play"></i>
                        </button>
                        <button class="task-control pause ${!task.heartbeat && task.status === 'paused' ? 'active' : ''}" title="Pause">
                            <i class="ph-fill ph-pause"></i>
                        </button>
                        <button class="task-control stop" title="Stop">
                            <i class="ph-fill ph-stop"></i>
                        </button>
                        <button class="task-edit" title="Edit Task"><i class="ph ph-pencil-simple"></i></button>
                      ` : ''}
                      <button class="task-delete" title="Delete Task"><i class="ph ph-trash"></i></button>
                  </div>
              `;

              if (task.status) {
                  const statusDiv = document.createElement('div');
                  statusDiv.className = `status-badge ${task.status}`;
                  statusDiv.textContent = task.status.replace('_', ' ').toUpperCase();
                  li.querySelector('.task-meta').appendChild(statusDiv);
              }

              li.querySelector('.task-checkbox').addEventListener('click', async () => {
                  const newCompleted = !task.completed;
                  await fetch(`${API_URL}/tasks/${task.id}`, {
                      method: 'PUT',
                      headers: {'Content-Type': 'application/json'},
                      body: JSON.stringify({ completed: newCompleted, heartbeat: false, status: newCompleted ? 'completed' : 'open' })
                  });
                  renderList();
              });

              li.querySelector('.task-delete').addEventListener('click', async (e) => {
                  e.stopPropagation();
                  showModal(
                      "Delete Task?",
                      `Are you sure you want to delete "${task.title}"?`,
                      async () => {
                          try {
                              await fetch(`${appState.backendUrl}/tasks/${task.id}`, { method: 'DELETE' });
                              console.log(`[Tasks] Deleted task ${task.id}. Refreshing...`);
                              await renderList(); 
                              showToast("Task deleted.", "success");
                          } catch (err) {
                              console.error("[Tasks] Deletion error:", err);
                              showToast("Failed to delete task.", "error");
                          }
                      }
                  );
              });

              if (!task.completed) {
                  li.querySelector('.task-control.play').addEventListener('click', async () => {
                      await fetch(`${API_URL}/tasks/${task.id}`, {
                          method: 'PUT',
                          headers: {'Content-Type': 'application/json'},
                          body: JSON.stringify({ heartbeat: true, status: 'processing' })
                      });
                      renderList();
                  });

                  li.querySelector('.task-control.pause').addEventListener('click', async () => {
                      await fetch(`${API_URL}/tasks/${task.id}`, {
                          method: 'PUT',
                          headers: {'Content-Type': 'application/json'},
                          body: JSON.stringify({ heartbeat: false, status: 'paused' })
                      });
                      renderList();
                  });

                  li.querySelector('.task-control.stop').addEventListener('click', async () => {
                      await fetch(`${API_URL}/tasks/${task.id}`, {
                          method: 'PUT',
                          headers: {'Content-Type': 'application/json'},
                          body: JSON.stringify({ heartbeat: false, status: 'open' })
                      });
                      renderList();
                  });

                  li.querySelector('.task-edit').addEventListener('click', () => {
                      editingTaskId = task.id;
                      appState.editingTaskId = task.id; // Persist
                      renderList();
                  });
              }
          }

          if (task.completed) {
              completedTaskList.appendChild(li);
          } else {
              openTaskList.appendChild(li);
          }
      });
  };

  const handleAdd = async () => {
      const title = titleInput.value.trim();
      if (!title) return;

      const newTask = {
          id: Date.now().toString(),
          title: title,
          context: contextInput.value.trim(),
          agentId: agentSelect.value || null,
          projectId: activeProjectId || 'default_project',
          completed: false,
          status: 'open'
      };

      await fetch(`${API_URL}/tasks`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(newTask)
      });
      
      titleInput.value = '';
      contextInput.value = '';
      renderList();
  };

  btnAddTask.addEventListener('click', handleAdd);
  titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd();
  });

  if (window._onTasksUpdated) {
      window.removeEventListener('ollamaclip_tasks_updated', window._onTasksUpdated);
  }
  window._onTasksUpdated = () => {
      renderList();
  };
  window.addEventListener('ollamaclip_tasks_updated', window._onTasksUpdated);

  renderList();
  
  container.appendChild(clone);
}
