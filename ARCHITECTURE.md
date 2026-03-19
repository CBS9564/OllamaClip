# OllamaClip - Architecture & Technical Documentation

This document provides a technical overview of the OllamaClip architecture, including the directory structure and the database schema.

## 📁 Directory Structure

OllamaClip follows a clean, modular structure where the UI is strictly separated from the persistence bridge and autonomous business logic.

```mermaid
graph TD
    Root["/"] --> Src["src/"]
    Root --> Workspaces["Workspaces/"]
    Root --> ServerJS["server.js (Express API)"]
    Root --> DBJS["backend_db.js (SQLite logic)"]
    Root --> Icons["Icon Sets (Phosphor)"]

    Src --> UI["src/ui/ (View Components)"]
    Src --> API["src/api/ (Ollama & Heartbeat)"]

    UI --> Chat["chat.js"]
    UI --> Tasks["tasks.js"]
    UI --> Dashboard["dashboard.js"]
    UI --> Utils["utils.js (Modals, Toasts)"]

    API --> Ollama["ollama.js (Streaming)"]
    API --> Heartbeat["heartbeat.js (Background loop)"]

    Workspaces --> ProjectA["[Project Name]/"]
    ProjectA --> AgentDir["Agent/"]
    AgentDir --> AgentMD["Agent_Name.md"]
```

## 🗄️ Database Schema (SQLite)

The persistence layer uses SQLite to manage projects, tasks, and chat history. Deletions follow a cascading pattern to ensure no orphan messages remain.

```mermaid
erDiagram
    PROJECTS ||--o{ AGENTS_META : "contains"
    PROJECTS ||--o{ TASKS : "manages"
    TASKS ||--o{ CHAT_MESSAGES : "history"
    AGENTS_META ||--o{ TASKS : "assigned to"

    PROJECTS {
        text id PK
        text name
        text context
        datetime created_at
    }

    AGENTS_META {
        text id PK
        text project_id FK
        text filename
    }

    TASKS {
        text id PK
        text agent_id FK
        text project_id FK
        text title
        text context
        text status
        boolean heartbeat
        boolean completed
        datetime created_at
    }

    CHAT_MESSAGES {
        text id PK
        text task_id FK
        text agent_id
        text role
        text content
        boolean is_proactive
        datetime created_at
    }

    SETTINGS {
        text key PK
        text value
    }
```

## 🚀 Key Flow: Agent Deletion Cascade

1. **User deletes Project**:
    - Purges all `tasks` of the project.
    - Purges all `chat_messages` of those tasks.
    - Purges all `agents_meta` links.
    - Physically deletes the `Workspaces/[ProjectName]` directory.

2. **User deletes Task**:
    - Purges the `task` from the DB.
    - Purges all `chat_messages` linked to that `task_id`.

3. **Autonomous Updates (Heartbeat)**:
    - Agents use the `HeartbeatManager` every 30s.
    - They can update task status via `[TASK_STATUS: ...]` or complete tasks via `[TASK_COMPLETE]`.
    - Every agent update is persisted to the DB and broadcasted to the UI via `ollamaclip_unread_updated`.
