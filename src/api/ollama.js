/**
 * Ollama API Connection Services
 * Default port: http://localhost:11434
 */
let ollamaApiUrl = 'http://localhost:11434/api';
let ollamaKeepAlive = '5m';

export function setOllamaConfig(url, keepAlive) {
    if (url) ollamaApiUrl = url;
    if (keepAlive) ollamaKeepAlive = keepAlive;
}

const getBaseUrl = () => ollamaApiUrl;
const getKeepAlive = () => ollamaKeepAlive;

/**
 * Fetch available models from local Ollama instance
 * @returns {Promise<Array>} List of models
 */
export async function fetchLocalModels() {
  try {
    const response = await fetch(`${getBaseUrl()}/tags`);
    if (!response.ok) {
      throw new Error(`Ollama Error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.models || [];
  } catch (error) {
    console.error("Failed to connect to Ollama. Is it running?", error);
    return null;
  }
}

/**
 * Simple Request Queue for Ollama to ensure sequential processing
 */
class OllamaQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
    }

    async push(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.isProcessing || this.queue.length === 0) return;
        
        this.isProcessing = true;
        const { task, resolve, reject } = this.queue.shift();

        try {
            const result = await task();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.isProcessing = false;
            // Immediate next process call
            setTimeout(() => this.process(), 0);
        }
    }
}

const ollamaQueue = new OllamaQueue();

/**
 * Internal chat function (without queue logic)
 */
async function _chatWithModel(model, messages, options = {}, onChunk, onComplete) {
  try {
    const defaultOptions = {
        temperature: 0.7,
        num_ctx: 2048
    };
    
    // Merge provided agent options with defaults
    const finalOptions = { ...defaultOptions, ...options };
    
    const response = await fetch(`${getBaseUrl()}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: true,
        keep_alive: getKeepAlive(),
        options: finalOptions
      })
    });

    if (!response.ok) {
        throw new Error(`Ollama Error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                if (parsed.message && parsed.message.content) {
                    onChunk(parsed.message.content);
                }
            } catch(e) {
                console.warn("Could not parse chunk:", line);
            }
        }
      }
    }
    
    if (onComplete) onComplete();

  } catch (error) {
    console.error("Chat error:", error);
    onChunk(`\n\n[Error communicating with model: ${error.message}]`);
    if(onComplete) onComplete();
    throw error;
  }
}

/**
 * Chat with a specific model using streaming response (Serialized via Queue)
 */
export async function chatWithModel(model, messages, options = {}, onChunk, onComplete) {
    return ollamaQueue.push(() => _chatWithModel(model, messages, options, onChunk, onComplete));
}

/**
 * Pull a model from the Ollama library
 * @param {string} name - Model name (e.g., 'llama3.1')
 * @param {Function} onProgress - Callback with progress percentage {status, completed, total}
 * @param {Function} onComplete - Callback when download finishes
 * @param {Function} onError - Callback for errors
 */
export async function pullModel(name, onProgress, onComplete, onError) {
  try {
    const response = await fetch(`${getBaseUrl()}/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, stream: true })
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            
            // Expected shape: {status: "downloading...", digest: "...", total: 123, completed: 45}
            if (onProgress) {
                onProgress(parsed);
            }
          } catch(e) {
            console.warn("Could not parse pull progress chunk:", line);
          }
        }
      }
    }

    if (onComplete) onComplete();

  } catch (error) {
    console.error("Pull error:", error);
    if (onError) onError(error);
  }
}

/**
 * Delete a local model from Ollama
 * @param {string} name - Model name (e.g., 'llama3.1:latest')
 * @returns {Promise<boolean>} Success status
 */
export async function deleteModel(name) {
  try {
    const response = await fetch(`${getBaseUrl()}/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name })
    });
    
    return response.ok;
  } catch (error) {
    console.error("Delete error:", error);
    return false;
  }
}
