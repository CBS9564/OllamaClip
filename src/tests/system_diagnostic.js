/**
 * OllamaClip - System Diagnostic Tests
 * This script runs basic checks on the UI rendering functions to ensure 
 * they don't throw errors and correctly access DOM elements.
 */

export async function runDiagnostics(appState) {
    console.group("🚀 OllamaClip System Diagnostics");
    const results = {
        passed: 0,
        failed: 0,
        errors: []
    };

    const test = (name, fn) => {
        try {
            fn();
            console.log(`✅ PASS: ${name}`);
            results.passed++;
        } catch (e) {
            console.error(`❌ FAIL: ${name}`, e);
            results.failed++;
            results.errors.push(`${name}: ${e.message}`);
        }
    };

    // --- TEST 1: Check Templates ---
    test("Templates Presence", () => {
        const required = ['tpl-dashboard', 'tpl-chat', 'tpl-agents', 'tpl-tasks', 'tpl-settings'];
        required.forEach(id => {
            if (!document.getElementById(id)) throw new Error(`Template missing: ${id}`);
        });
    });

    // --- TEST 2: Chat Rendering ---
    test("Chat Render Stability", () => {
        const container = document.createElement('div');
        const mockAgents = [{ id: 'test', name: 'Tester', role: 'Unit', model: 'm1', color: '#ff0000', systemPrompt: '...' }];
        
        // This is the function we just fixed
        import('./ui/chat.js').then(module => {
            module.renderChat(container, mockAgents);
        });
    });

    // --- TEST 3: Agents Grid Rendering ---
    test("Agents Grid Stability", () => {
        const container = document.createElement('div');
        const mockAgents = [{ id: 'test', name: 'Tester', role: 'Unit', model: 'm1', color: '#ff0000', systemPrompt: '...' }];
        
        import('./ui/agents.js').then(module => {
            module.renderAgents(container, mockAgents, () => {}, () => {});
        });
    });

    console.groupEnd();
    return results;
}
