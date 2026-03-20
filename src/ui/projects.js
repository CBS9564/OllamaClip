export function renderProjects(container, appState, updateView) {
    const tpl = document.getElementById('tpl-projects');
    const clone = tpl.content.cloneNode(true);
    container.innerHTML = '';

    const listContainer = clone.querySelector('#projects-list-container');
    const titleInput = clone.querySelector('#new-project-title');
    const btnCreate = clone.querySelector('#btn-create-project');

    const contextInput = clone.querySelector('#new-project-context');

    const renderList = () => {
        listContainer.innerHTML = '';
        if (appState.projects.length === 0) {
            listContainer.innerHTML = '<li class="task-item"><div class="task-info"><span>No projects exist. Create one above!</span></div></li>';
            return;
        }

        appState.projects.forEach(project => {
            const li = document.createElement('li');
            li.className = `task-item ${project.id === appState.activeProjectId ? 'active-project' : ''}`;
            if (project.id === appState.activeProjectId) {
                li.style.borderLeft = '3px solid var(--accent-primary)';
            }
            
            const isProtected = project.id === 'default_project';

            li.innerHTML = `
                <div class="task-info">
                    <span class="task-title" style="font-weight: 600;">${project.name}</span>
                    <span class="task-meta">${isProtected ? 'Protected Root Project' : 'Custom Project'}</span>
                    ${project.context ? `<p style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">${project.context}</p>` : ''}
                    
                    <div class="project-memory-section">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <label style="font-size:0.7rem; font-weight:700; color:var(--accent-primary); letter-spacing:0.05em;">STRATEGIC MEMORY (1B BRAIN)</label>
                            <button class="btn btn-sm btn-save-memory" style="padding:2px 6px; font-size:0.7rem; background:rgba(255,255,255,0.05);" title="Save Memory">
                                <i class="ph ph-floppy-disk"></i> Save
                            </button>
                        </div>
                        <textarea class="project-memory-textarea" placeholder="Insights, architecture patterns, and long-term project knowledge stay here...">${project.memory || ''}</textarea>
                    </div>
                </div>
                <div class="task-actions" style="align-self: flex-start; margin-top: 10px;">
                    <button class="btn btn-sm btn-secondary btn-switch" title="Set Active Context" ${project.id === appState.activeProjectId ? 'disabled' : ''}>
                        <i class="ph ph-check-circle"></i> ${project.id === appState.activeProjectId ? 'Active' : 'Switch To'}
                    </button>
                    ${!isProtected ? `<button class="btn btn-sm btn-danger btn-delete" title="Delete Project"><i class="ph ph-trash"></i></button>` : ''}
                </div>
            `;

            // Memory Save Logic
            const btnSaveMem = li.querySelector('.btn-save-memory');
            const txtMem = li.querySelector('.project-memory-textarea');
            btnSaveMem.addEventListener('click', async () => {
                const newMem = txtMem.value.trim();
                btnSaveMem.disabled = true;
                btnSaveMem.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
                
                try {
                    const res = await fetch(`${appState.backendUrl}/projects/${project.id}/memory`, {
                        method: 'PUT',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ memory: newMem })
                    });
                    if (res.ok) {
                        project.memory = newMem;
                        btnSaveMem.innerHTML = '<i class="ph ph-check"></i> Saved';
                        setTimeout(() => {
                            btnSaveMem.disabled = false;
                            btnSaveMem.innerHTML = '<i class="ph ph-floppy-disk"></i> Save';
                        }, 2000);
                    }
                } catch(e) {
                    console.error("Failed to save project memory", e);
                    btnSaveMem.disabled = false;
                    btnSaveMem.innerHTML = '<i class="ph ph-warning"></i> Error';
                }
            });

            // Switch active project
            const btnSwitch = li.querySelector('.btn-switch');
            if (btnSwitch) {
                btnSwitch.addEventListener('click', () => {
                    appState.activeProjectId = project.id;
                    appState.activeProjectName = project.name;
                    window.dispatchEvent(new CustomEvent('ollamaclip_context_changed'));
                    renderList();
                    updateView();
                });
            }

            // Delete project
            const btnDelete = li.querySelector('.btn-delete');
            if (btnDelete) {
                btnDelete.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    console.log(`[ProjectsUI] Delete clicked for: ${project.name} (ID: ${project.id})`);
                    
                    if (btnDelete.dataset.confirming !== 'true') {
                        // First click: enter confirmation state
                        btnDelete.dataset.confirming = 'true';
                        btnDelete.innerHTML = '<i class="ph ph-warning"></i> Confirm?';
                        btnDelete.classList.add('btn-confirming');
                        
                        // Reset after 3 seconds if not clicked again
                        setTimeout(() => {
                            if (btnDelete.dataset.confirming === 'true') {
                                btnDelete.dataset.confirming = 'false';
                                btnDelete.innerHTML = '<i class="ph ph-trash"></i>';
                                btnDelete.classList.remove('btn-confirming');
                            }
                        }, 3000);
                        return;
                    }

                    // Second click: perform deletion
                    try {
                        console.log(`[ProjectsUI] Sending DELETE request to: ${appState.backendUrl}/projects/${project.id}`);
                        btnDelete.disabled = true;
                        btnDelete.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';

                        const res = await fetch(`${appState.backendUrl}/projects/${project.id}`, { method: 'DELETE' });
                        
                        if (res.ok) {
                            console.log(`[ProjectsUI] Delete successful for: ${project.id}`);
                            appState.projects = appState.projects.filter(p => p.id !== project.id);
                            if (appState.activeProjectId === project.id) {
                                appState.activeProjectId = appState.projects.length > 0 ? appState.projects[0].id : null;
                                appState.activeProjectName = appState.projects.length > 0 ? appState.projects[0].name : "No Project";
                                window.dispatchEvent(new CustomEvent('ollamaclip_context_changed'));
                            }
                            window.dispatchEvent(new CustomEvent('ollamaclip_projects_updated'));
                        } else {
                            const errData = await res.json().catch(() => ({}));
                            console.error(`[ProjectsUI] Delete failed:`, errData);
                            alert(errData.error || "Failed to delete project.");
                            // Reset button
                            btnDelete.dataset.confirming = 'false';
                            btnDelete.innerHTML = '<i class="ph ph-trash"></i>';
                            btnDelete.classList.remove('btn-confirming');
                            btnDelete.disabled = false;
                        }
                    } catch (e) {
                        console.error(`[ProjectsUI] Network error during delete:`, e);
                        alert("Error deleting project.");
                        btnDelete.disabled = false;
                    }
                });
            }

            listContainer.appendChild(li);
        });
    };

    btnCreate.addEventListener('click', async () => {
        const name = titleInput.value.trim();
        if (!name) return;

        btnCreate.disabled = true;
        btnCreate.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Creating...';

        try {
            const res = await fetch(`${appState.backendUrl}/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, context: contextInput.value.trim() })
            });
            const data = await res.json();
            
            if (data.success) {
                appState.projects.push({ id: data.id, name: data.name, context: data.context || '' });
                
                if (data.ceo) {
                    appState.agents.push(data.ceo);
                    localStorage.setItem('ollamaclip_agents', JSON.stringify(appState.agents));
                    window.dispatchEvent(new CustomEvent('ollamaclip_agents_updated'));
                }

                if (window.fetchTasks) await window.fetchTasks();

                titleInput.value = '';
                contextInput.value = '';
                window.dispatchEvent(new CustomEvent('ollamaclip_projects_updated'));
                window.dispatchEvent(new CustomEvent('ollamaclip_tasks_updated'));
            } else {
                alert(data.error || "Failed to create project");
            }
        } catch (e) {
            alert("Error communicating with server.");
        } finally {
            btnCreate.disabled = false;
            btnCreate.innerHTML = '<i class="ph ph-plus"></i> Create';
        }
    });

    // Clean up previous event listener to avoid accumulation
    if (window._onProjectsUpdatedRef) {
        window.removeEventListener('ollamaclip_projects_updated', window._onProjectsUpdatedRef);
    }
    window._onProjectsUpdatedRef = () => renderList();
    window.addEventListener('ollamaclip_projects_updated', window._onProjectsUpdatedRef);
    
    // Clean up listener if container is re-rendered (though updateView usually nukes container)
    // In our simplified vanilla system, we'll just ensure we don't leak too many if possible
    // or rely on updateView nuke.

    renderList();
    container.appendChild(clone);
}
