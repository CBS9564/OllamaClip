# OllamaClip

OllamaClip is a high-performance, lightweight web-based orchestration platform for local AI agents. Inspired by Paperclip AI, this project is built from scratch using pure Vanilla JavaScript, HTML, and CSS (Vite template). It communicates seamlessly with local Ollama instances to provide a fast, secure, and visually premium dashboard for managing and interacting with your locally hosted language models.

![OllamaClip Concept](https://raw.githubusercontent.com/phosphor-icons/core/master/assets/regular/paperclip.svg)

## Features

- **Zero Heavy Dependencies**: Built entirely with Vanilla JS and native browser APIs (No React, Vue, Tailwind, etc.), ensuring maximum execution speed and low resource usage on Windows environments.
- **Glassmorphism UI & Dark Mode**: A stunning, modern design utilizing CSS custom properties, backdrop filters, and subtle micro-animations for an elevated user experience.
- **Native Ollama Integration**: Connects directly to `http://localhost:11434` without intermediate servers, retrieving available models dynamically and streaming chat responses in real time.
- **Agent Orchestration**: Create AI agents and assign them specific roles, system prompts, and individual local models (e.g., Llama 3 for coding, Mistral for copy).
- **Task Management System**: A dedicated UI to create tasks, assign them to specific agents in your workforce, and track their completion status.
- **Shared Workspace Memory & Mentions (V3)**: All agents collaborate in a single, persistent Chat Workspace. Use `@AgentName` in your messages to summon specific models into the flow, equipped with zero-shot context switching and VRAM optimization (`keep_alive`).
- **Interactive Dashboard & Model Manager (V5)**: Track active agents and manage local models. **Delete** models to free up space or **Pull** new ones directly from the Ollama Hub with real-time download progress.
- **Advanced Agent Management (V6)**: 
    - Full **Visual Agent Builder** Modal (replaces simple prompts).
    - Advanced parameters: Tuning of **Temperature** and **Context Size** per agent.
    - Custom **Accent Colors** for personalization.
    - Dedicated **Agents Management** grid with Edit and Delete support.
- **Persistent Local Memory**: All configurations, agents, chat histories, and tasks are stored strictly in `localStorage`, persisting across reloads while maintaining privacy.
- **Settings & Configuration (V4)**: Modify your Ollama Base URL for remote instances, control model VRAM retention durations, and manage local data securely.

## Prerequisites

1.  **Node.js**: Ensure Node.js is installed to run the local Vite development server.
2.  **Ollama**: Install and run [Ollama](https://ollama.com/) locally. Ensure you have pulled at least one model (e.g., `ollama run llama3`).

## Installation & Setup

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/your-username/OllamaClip.git
    cd OllamaClip
    ```

2.  **Install Dependencies**:
    The project uses standard Vite dependencies for the development server and `phosphor-icons` for scalable vector icons.
    ```bash
    npm install
    ```

3.  **Start the Development Server**:
    ```bash
    npm run dev
    ```

4.  **Open the Application**:
    Vite will start a local server (usually `http://localhost:5173` or `http://localhost:5174`). Open this URL in your web browser.

## Usage Guide

1.  **Verify Connection**: Check the bottom left of the application sidebar. If Ollama is running, it will indicate "Ollama Connected" with a pulsing green indicator.
2.  **Create an Agent**: Click the "New Agent" button in the top right. Follow the prompt wizard to assign a name, role, local model, and system prompt.
3.  **Start a Chat**: Navigate to the "Inbox" tab. Select your newly created agent from the sidebar and start sending messages. The agent's response will stream live directly from your local Ollama instance.

## Architecture & Code Structure

-   `index.html`: semantic layout with templates for dynamic view rendering.
-   `src/style.css`: Core design system, CSS variables, Glassmorphism utilities, and responsive layouts.
-   `src/main.js`: Setup logic, router, state management (`appState`), and the Agent Creation Wizard logic.
-   `src/api/ollama.js`: Network layer containing `fetchLocalModels` and `chatWithModel` (handles text streaming).
-   `src/ui/dashboard.js`: Rendering logic for the stats and organizational chart.
-   `src/ui/chat.js`: Chat interface rendering, text streaming UI logic, persistent memory save/load methods, and user input handling.
-   `src/ui/tasks.js`: Complete task management interface with assignment logic and state persistence.

## Development Principles

This project adheres strictly to **Optimization, Security, and User Experience**. By stripping away heavy frameworks, we eliminate dependency vulnerabilities and optimize TTFB (Time to First Byte). The pure CSS approach delivers a highly customized "WOW" factor right out of the box.

---

*Note: This project is meant to be run alongside a local Ollama instance on default port `11434`. Cross-Origin Resource Sharing (CORS) must be allowed if Ollama is running on a different port or machine.*
