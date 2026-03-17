export function renderTasks(container, agents) {
  const tpl = document.getElementById('tpl-tasks');
  const clone = tpl.content.cloneNode(true);
  container.innerHTML = '';
  
  const titleInput = clone.querySelector('#task-title-input');
  const agentSelect = clone.querySelector('#task-agent-select');
  const btnAddTask = clone.querySelector('#btn-add-task');
  const openTaskList = clone.querySelector('#open-task-list');
  const completedTaskList = clone.querySelector('#completed-task-list');
  
  // Helper to save to storage
  const saveTasksToStorage = (updatedTasks) => {
      localStorage.setItem('ollamaclip_tasks', JSON.stringify(updatedTasks));
  };

  const getAgentInfo = (agentId) => {
      const ag = agents.find(a => a.id === agentId);
      return ag ? { name: ag.name, color: ag.color } : { name: 'Unassigned', color: 'var(--text-muted)' };
  };

  const renderList = () => {
      const allTasks = JSON.parse(localStorage.getItem('ollamaclip_tasks') || '[]');
      
      const openTasks = allTasks.filter(t => !t.completed);
      const completedTasks = allTasks.filter(t => t.completed);

      if (openTasks.length === 0) {
          openTaskList.innerHTML = '<li style="color:var(--text-muted); font-size:0.85rem">No open tasks.</li>';
      }
      
      if (completedTasks.length === 0) {
          completedTaskList.innerHTML = '<li style="color:var(--text-muted); font-size:0.85rem">No completed tasks yet.</li>';
      }

      allTasks.forEach(task => {
          const li = document.createElement('li');
          li.className = `task-item ${task.editing ? 'editing' : ''}`;
          
          const agentInfo = getAgentInfo(task.agentId);
          
          if (task.editing) {
              li.innerHTML = `
                  <div class="task-edit-form" style="display:flex; flex-direction:column; gap:8px; width:100%;">
                      <input type="text" class="edit-task-title" value="${task.title}" style="width:100%;" />
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
              
              li.querySelector('.btn-save-edit').addEventListener('click', () => {
                  const currentTasks = JSON.parse(localStorage.getItem('ollamaclip_tasks') || '[]');
                  const tIdx = currentTasks.findIndex(t => t.id === task.id);
                  if (tIdx !== -1) {
                      currentTasks[tIdx].title = li.querySelector('.edit-task-title').value.trim();
                      currentTasks[tIdx].agentId = li.querySelector('.edit-task-agent').value || null;
                      currentTasks[tIdx].editing = false;
                      localStorage.setItem('ollamaclip_tasks', JSON.stringify(currentTasks));
                  }
                  renderList();
              });
              
              li.querySelector('.btn-cancel-edit').addEventListener('click', () => {
                  renderList(); // Just re-render, don't save
              });
          } else {
              li.innerHTML = `
                  <div class="task-checkbox ${task.completed ? 'checked' : ''}"></div>
                  <div class="task-content">
                      <span class="task-title">${task.title}</span>
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

              // Status Badge
              if (task.status) {
                  const statusDiv = document.createElement('div');
                  statusDiv.className = `status-badge ${task.status}`;
                  statusDiv.textContent = task.status.replace('_', ' ').toUpperCase();
                  li.querySelector('.task-meta').appendChild(statusDiv);
              }

              // Event Listeners
              li.querySelector('.task-checkbox').addEventListener('click', () => {
                  const currentTasks = JSON.parse(localStorage.getItem('ollamaclip_tasks') || '[]');
                  const tIdx = currentTasks.findIndex(t => t.id === task.id);
                  if (tIdx !== -1) {
                      currentTasks[tIdx].completed = !currentTasks[tIdx].completed;
                      if (currentTasks[tIdx].completed) {
                          currentTasks[tIdx].heartbeat = false;
                          currentTasks[tIdx].status = 'completed';
                      }
                      localStorage.setItem('ollamaclip_tasks', JSON.stringify(currentTasks));
                  }
                  renderList();
              });

              li.querySelector('.task-delete').addEventListener('click', (e) => {
                  e.stopPropagation();
                  if (confirm("Delete this task?")) {
                      const currentTasks = JSON.parse(localStorage.getItem('ollamaclip_tasks') || '[]');
                      const filtered = currentTasks.filter(t => t.id !== task.id);
                      localStorage.setItem('ollamaclip_tasks', JSON.stringify(filtered));
                      renderList();
                  }
              });

              if (!task.completed) {
                  li.querySelector('.task-control.play').addEventListener('click', () => {
                      const currentTasks = JSON.parse(localStorage.getItem('ollamaclip_tasks') || '[]');
                      const tIdx = currentTasks.findIndex(t => t.id === task.id);
                      if (tIdx !== -1) {
                          currentTasks[tIdx].heartbeat = true;
                          currentTasks[tIdx].status = 'processing';
                          localStorage.setItem('ollamaclip_tasks', JSON.stringify(currentTasks));
                      }
                      renderList();
                  });

                  li.querySelector('.task-control.pause').addEventListener('click', () => {
                      const currentTasks = JSON.parse(localStorage.getItem('ollamaclip_tasks') || '[]');
                      const tIdx = currentTasks.findIndex(t => t.id === task.id);
                      if (tIdx !== -1) {
                          currentTasks[tIdx].heartbeat = false;
                          currentTasks[tIdx].status = 'paused';
                          localStorage.setItem('ollamaclip_tasks', JSON.stringify(currentTasks));
                      }
                      renderList();
                  });

                  li.querySelector('.task-control.stop').addEventListener('click', () => {
                      const currentTasks = JSON.parse(localStorage.getItem('ollamaclip_tasks') || '[]');
                      const tIdx = currentTasks.findIndex(t => t.id === task.id);
                      if (tIdx !== -1) {
                          currentTasks[tIdx].heartbeat = false;
                          currentTasks[tIdx].status = '';
                          localStorage.setItem('ollamaclip_tasks', JSON.stringify(currentTasks));
                      }
                      renderList();
                  });

                  li.querySelector('.task-edit').addEventListener('click', () => {
                      // We can use a special session-only flag for editing
                      task.editing = true; 
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

  const handleAdd = () => {
      const title = titleInput.value.trim();
      if (!title) return;

      const currentTasks = JSON.parse(localStorage.getItem('ollamaclip_tasks') || '[]');
      const newTask = {
          id: Date.now().toString(),
          title: title,
          agentId: agentSelect.value || null,
          completed: false,
          createdAt: new Date().toISOString()
      };

      currentTasks.push(newTask);
      saveTasksToStorage(currentTasks);
      
      titleInput.value = '';
      renderList();
  };

  btnAddTask.addEventListener('click', handleAdd);
  titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd();
  });

  // Listen for Heartbeat status updates
  if (window._onTasksUpdated) {
      window.removeEventListener('ollamaclip_tasks_updated', window._onTasksUpdated);
  }
  window._onTasksUpdated = () => {
      renderList();
  };
  window.addEventListener('ollamaclip_tasks_updated', window._onTasksUpdated);

  // Initial render
  renderList();
  
  container.appendChild(clone);
}
