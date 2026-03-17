export function renderTasks(container, agents) {
  const tpl = document.getElementById('tpl-tasks');
  const clone = tpl.content.cloneNode(true);
  container.innerHTML = '';
  
  const titleInput = clone.querySelector('#task-title-input');
  const agentSelect = clone.querySelector('#task-agent-select');
  const btnAddTask = clone.querySelector('#btn-add-task');
  const openTaskList = clone.querySelector('#open-task-list');
  const completedTaskList = clone.querySelector('#completed-task-list');
  
  // State
  let tasks = JSON.parse(localStorage.getItem('ollamaclip_tasks') || '[]');

  // Populate Select
  agents.forEach(agent => {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = agent.name;
      agentSelect.appendChild(opt);
  });

  const saveTasks = () => {
      localStorage.setItem('ollamaclip_tasks', JSON.stringify(tasks));
  };

  const getAgentInfo = (agentId) => {
      const ag = agents.find(a => a.id === agentId);
      return ag ? { name: ag.name, color: ag.color } : { name: 'Unassigned', color: 'var(--text-muted)' };
  };

  const renderList = () => {
      openTaskList.innerHTML = '';
      completedTaskList.innerHTML = '';
      
      const openTasks = tasks.filter(t => !t.completed);
      const completedTasks = tasks.filter(t => t.completed);

      if (openTasks.length === 0) {
          openTaskList.innerHTML = '<li style="color:var(--text-muted); font-size:0.85rem">No open tasks.</li>';
      }
      
      if (completedTasks.length === 0) {
          completedTaskList.innerHTML = '<li style="color:var(--text-muted); font-size:0.85rem">No completed tasks yet.</li>';
      }

      tasks.forEach(task => {
          const li = document.createElement('li');
          li.className = 'task-item';
          
          const agentInfo = getAgentInfo(task.agentId);
          
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
              <button class="task-delete" title="Delete Task"><i class="ph ph-trash"></i></button>
          `;

          // Toggle Complete
          li.querySelector('.task-checkbox').addEventListener('click', () => {
              task.completed = !task.completed;
              saveTasks();
              renderList();
          });

          // Delete
          li.querySelector('.task-delete').addEventListener('click', () => {
              if (confirm("Delete this task?")) {
                  tasks = tasks.filter(t => t.id !== task.id);
                  saveTasks();
                  renderList();
              }
          });

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

      const newTask = {
          id: Date.now().toString(),
          title: title,
          agentId: agentSelect.value || null,
          completed: false,
          createdAt: new Date().toISOString()
      };

      tasks.push(newTask);
      saveTasks();
      
      titleInput.value = '';
      renderList();
  };

  btnAddTask.addEventListener('click', handleAdd);
  titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd();
  });

  // Initial render
  renderList();
  
  container.appendChild(clone);
}
