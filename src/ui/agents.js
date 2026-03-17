/**
 * Agents View Rendering Logic
 */
export function renderAgents(container, agents, onEdit, onDelete) {
    const tpl = document.getElementById('tpl-agents');
    if (!tpl) return;

    const clone = tpl.content.cloneNode(true);
    const grid = clone.getElementById('agents-grid');

    if (agents.length === 0) {
        grid.innerHTML = '<p class="empty-state" style="grid-column: 1/-1; padding: 48px;">No agents configured yet. Use the "New Agent" button to get started.</p>';
    } else {
        agents.forEach(agent => {
            const card = document.createElement('div');
            card.className = 'agent-card glass-panel';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.padding = '24px';
            card.style.gap = '16px';
            card.style.borderTop = `4px solid ${agent.color || 'var(--accent-primary)'}`;
            card.style.transition = 'transform 0.2s ease, background 0.2s ease';
            card.style.cursor = 'default';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 40px; height: 40px; border-radius: 10px; background: ${agent.color}20; display: flex; align-items: center; justify-content: center; color: ${agent.color}; font-size: 1.25rem;">
                            <i class="ph ph-robot"></i>
                        </div>
                        <div>
                            <h3 style="font-size: 1.1rem; font-weight: 600;">${agent.name}</h3>
                            <span style="font-size: 0.8rem; color: var(--text-secondary); text-transform: uppercase;">${agent.role}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-icon btn-edit-agent" data-id="${agent.id}" title="Edit Agent" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-light); color: var(--text-secondary); width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-icon btn-delete-agent" data-id="${agent.id}" title="Delete Agent" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--danger); width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem;">
                        <i class="ph ph-cpu" style="color: var(--text-muted);"></i>
                        <span style="color: var(--text-secondary);">Model:</span>
                        <span class="model-badge">${agent.model}</span>
                    </div>
                </div>

                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; font-size: 0.85rem; color: var(--text-secondary); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">
                    ${agent.systemPrompt}
                </div>

                <div style="display: flex; gap: 12px; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--border-light);">
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                        <span style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Temp</span>
                        <span style="font-size: 0.9rem; font-weight: 500;">${agent.options?.temperature || 0.7}</span>
                    </div>
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                        <span style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Context</span>
                        <span style="font-size: 0.9rem; font-weight: 500;">${agent.options?.num_ctx || 2048}</span>
                    </div>
                </div>
            `;

            const btnEdit = card.querySelector('.btn-edit-agent');
            btnEdit.addEventListener('click', () => onEdit(agent.id));

            const btnDelete = card.querySelector('.btn-delete-agent');
            btnDelete.addEventListener('click', () => onDelete(agent.id));

            grid.appendChild(card);
        });
    }

    container.innerHTML = '';
    container.appendChild(clone);
}
