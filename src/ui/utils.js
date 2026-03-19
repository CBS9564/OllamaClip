/**
 * Global UI Utilities
 */

export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ph-info';
    if (type === 'success') icon = 'ph-check-circle';
    if (type === 'error') icon = 'ph-warning-octagon';
    if (type === 'warning') icon = 'ph-warning';

    toast.innerHTML = `
        <i class="ph-fill ${icon}"></i>
        <div class="toast-content">${message}</div>
    `;

    container.appendChild(toast);

    // Fade in
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

export function showModal(title, message, onConfirm, onCancel) {
    const container = document.getElementById('modal-container');
    const tpl = document.getElementById('tpl-modal');
    if (!container || !tpl) return;

    const clone = tpl.content.cloneNode(true);
    const overlay = clone.querySelector('.modal-overlay');
    
    clone.querySelector('#modal-title').textContent = title;
    clone.querySelector('#modal-message').textContent = message;

    const close = () => {
        const overlay = container.querySelector('.modal-overlay');
        if (overlay) overlay.classList.remove('active');
        setTimeout(() => {
            container.classList.add('hidden');
            container.innerHTML = '';
        }, 300); // Wait for fade out
    };

    clone.querySelector('#modal-btn-confirm').addEventListener('click', () => {
        if (onConfirm) onConfirm();
        close();
    });

    clone.querySelector('#modal-btn-cancel').addEventListener('click', () => {
        if (onCancel) onCancel();
        close();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    container.innerHTML = '';
    container.appendChild(clone);
    container.classList.remove('hidden');
    
    // Trigger fade in animation
    setTimeout(() => {
        const appendedOverlay = container.querySelector('.modal-overlay');
        if (appendedOverlay) appendedOverlay.classList.add('active');
    }, 10);
}

export function simpleMarkdown(text) {
    if (!text) return '';
    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/^\s*-\s+(.+)$/gm, '<li>$1</li>');
        
    if (html.includes('<li>')) {
        let lines = html.split('\n');
        let inList = false;
        let newHtml = '';
        for (let line of lines) {
            if (line.includes('<li>') && !inList) {
                newHtml += '<ul>' + line;
                inList = true;
            } else if (!line.includes('<li>') && inList) {
                newHtml += '</ul>' + line;
                inList = false;
            } else {
                newHtml += line + '\n';
            }
        }
        if (inList) newHtml += '</ul>';
        html = newHtml;
    }
    
    return html.replace(/\n/g, '<br>');
}
