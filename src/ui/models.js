import { pullModel, deleteModel, fetchLocalModels } from '../api/ollama.js';

export function renderModelsManager(container, appStateRef, updateViewCallback) {
  const tpl = document.getElementById('tpl-models');
  const clone = tpl.content.cloneNode(true);
  
  // Bind Back Button
  const btnBack = clone.querySelector('#btn-back-dashboard');
  if (btnBack) {
      btnBack.addEventListener('click', () => {
          appStateRef.activeView = 'dashboard';
          updateViewCallback();
      });
  }

  // Render Installed Models List
  const localModelsList = clone.querySelector('#local-models-list');
  const localModels = appStateRef.localModels;
  
  if (localModelsList) {
      if (localModels && localModels.length > 0) {
          localModels.forEach(model => {
              const row = document.createElement('div');
              row.style.display = 'flex';
              row.style.alignItems = 'center';
              row.style.justifyContent = 'space-between';
              row.style.padding = '8px 12px';
              row.style.background = 'rgba(0,0,0,0.2)';
              row.style.borderRadius = '8px';
              
              row.innerHTML = `
                  <div style="display: flex; flex-direction: column;">
                      <span style="font-weight: 500; color: var(--text-primary);">${model.name}</span>
                      <span style="font-size: 0.75rem; color: var(--text-muted);">${formatBytes(model.size)} • ${model.details?.parameter_size || 'Unknown'}</span>
                  </div>
                  <button class="btn btn-delete-model" data-model="${model.name}" style="background: transparent; color: var(--text-muted); border: none; padding: 4px; cursor: pointer; transition: color 0.2s;">
                      <i class="ph ph-trash" style="pointer-events: none;"></i>
                  </button>
              `;
              localModelsList.appendChild(row);
          });
      } else {
          localModelsList.innerHTML = '<p class="empty-state">No models installed locally.</p>';
      }
  }

  // Bind Delete Model Actions
  const deleteBtnElements = clone.querySelectorAll('.btn-delete-model');
  deleteBtnElements.forEach(btn => {
      btn.addEventListener('click', async (e) => {
          const targetModel = e.target.dataset.model;
          if (confirm(`Are you sure you want to delete the model '${targetModel}' from your system?`)) {
              btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i>';
              const success = await deleteModel(targetModel);
              
              if (success) {
                  // Refresh the global models list and trigger re-render
                  if (appStateRef && updateViewCallback) {
                     appStateRef.localModels = await fetchLocalModels();
                     updateViewCallback();
                  }
              } else {
                  alert(`Failed to delete '${targetModel}'. Ensure Ollama is running.`);
                  btn.innerHTML = '<i class="ph ph-trash"></i>';
              }
          }
      });
  });

  // Handle Pull Model Logic
  const btnPull = clone.querySelector('#btn-pull-model');
  const inputPull = clone.querySelector('#input-pull-model');
  const progressContainer = clone.querySelector('#pull-progress-container');
  const progressBar = clone.querySelector('#pull-progress-bar');
  const pullStatusText = clone.querySelector('#pull-status-text');
  const pullPercentage = clone.querySelector('#pull-percentage');

  if (btnPull && inputPull) {
      btnPull.addEventListener('click', () => {
          const targetModel = inputPull.value.trim().toLowerCase();
          if (!targetModel) return;

          // Lock UI
          btnPull.disabled = true;
          inputPull.disabled = true;
          progressContainer.style.display = 'flex';
          pullStatusText.textContent = `Initializing pull for ${targetModel}...`;
          pullPercentage.textContent = '0%';
          progressBar.style.width = '0%';

          pullModel(
              targetModel,
              (progressObj) => {
                  // e.g. status: "downloading...", total: 1000, completed: 500
                  if (progressObj.status) {
                      pullStatusText.textContent = progressObj.status;
                  }
                  if (progressObj.total && progressObj.completed) {
                      const pct = Math.round((progressObj.completed / progressObj.total) * 100);
                      pullPercentage.textContent = `${pct}%`;
                      progressBar.style.width = `${pct}%`;
                  }
              },
              async () => {
                  // On Complete
                  pullStatusText.textContent = "Download complete!";
                  pullPercentage.textContent = "100%";
                  progressBar.style.width = "100%";
                  progressBar.style.background = "var(--success)";
                  
                  // Refresh the models list and UI
                  if (appStateRef && updateViewCallback) {
                     setTimeout(async () => {
                        appStateRef.localModels = await fetchLocalModels();
                        updateViewCallback();
                     }, 1500); 
                  }
              },
              (error) => {
                  // On Error
                  alert(`Failed to pull model: ${error.message}`);
                  btnPull.disabled = false;
                  inputPull.disabled = false;
                  progressContainer.style.display = 'none';
              }
          );
      });
      
      // Allow pressing Enter in the input field
      inputPull.addEventListener('keypress', (e) => {
         if(e.key === 'Enter') {
             btnPull.click();
         } 
      });
  }

  container.innerHTML = '';
  container.appendChild(clone);
}

// Utility function to format bytes
function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
