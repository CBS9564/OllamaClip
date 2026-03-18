export function renderProjects(container, appState, updateView) {
    const tpl = document.getElementById('tpl-projects');
    const clone = tpl.content.cloneNode(true);
    container.innerHTML = '';

    const listContainer = clone.querySelector('#projects-list-container');
    const titleInput = clone.querySelector('#new-project-title');
    const btnCreate = clone.querySelector('#btn-create-project');

    const renderList = () => {
        listContainer.innerHTML = '';
        if (appState.projects.length === 0) {
            listContainer.innerHTML = '<li class="task-item"><div class="task-info"><span>No projects exist inside the Workspace. Create one above!</span></div></li>';
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
                </div>
                <div class="task-actions">
                    <button class="btn btn-sm btn-secondary btn-switch" title="Set Active Context" ${project.id === appState.activeProjectId ? 'disabled' : ''}>
                        <i class="ph ph-check-circle"></i> ${project.id === appState.activeProjectId ? 'Active' : 'Switch To'}
                    </button>
                    ${!isProtected ? `<button class="btn btn-sm btn-danger btn-delete" title="Delete Project"><i class="ph ph-trash"></i></button>` : ''}
                </div>
            `;

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
                btnDelete.addEventListener('click', async () => {
                    if (confirm(`Are you sure you want to delete the project "${project.name}"? This action cannot be undone.`)) {
                        try {
                            const res = await fetch(`${appState.backendUrl}/projects/${project.id}`, { method: 'DELETE' });
                            if (res.ok) {
                                appState.projects = appState.projects.filter(p => p.id !== project.id);
                                if (appState.activeProjectId === project.id) {
                                    appState.activeProjectId = appState.projects.length > 0 ? appState.projects[0].id : null;
                                    appState.activeProjectName = appState.projects.length > 0 ? appState.projects[0].name : "No Project";
                                    window.dispatchEvent(new CustomEvent('ollamaclip_context_changed'));
                                }
                                renderList();
                                updateView();
                            } else {
                                alert("Failed to delete project.");
                            }
                        } catch (e) {
                            alert("Error deleting project.");
                        }
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
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            
            if (data.success) {
                appState.projects.push({ id: data.id, name: data.name, workspace_id: data.workspace_id });
                titleInput.value = '';
                renderList();
                updateView();
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

    renderList();
    container.appendChild(clone);
}
