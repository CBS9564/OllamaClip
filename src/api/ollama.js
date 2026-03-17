/**
 * Ollama API Connection Services
 * Default port: http://localhost:11434
 */
const getBaseUrl = () => localStorage.getItem('ollamaclip_api_url') || 'http://localhost:11434/api';
const getKeepAlive = () => localStorage.getItem('ollamaclip_keep_alive') || '5m';

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
 * Chat with a specific model using streaming response
 * @param {string} model - The name of the model (e.g., 'llama2')
 * @param {Array} messages - Chat history array [{role: 'user', content: '...'}]
 * @param {Function} onChunk - Callback for parsing streaming text chunks
 * @param {Function} onComplete - Callback when stream finishes
 */
export async function chatWithModel(model, messages, onChunk, onComplete) {
  try {
    const response = await fetch(`${getBaseUrl()}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: true,
        keep_alive: getKeepAlive() // V4 Optimization: Dynamic VRAM tuning
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
        // The chunk might contain multiple JSON objects separated by newlines
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
  }
}
