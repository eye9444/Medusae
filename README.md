<p align="center"><img src="public/brand/medusae-sculpture-v1.png" width="120" alt="Medusae" /></p>

# Medusae

**Follow the threads.** Explore a public GitHub repository through a terminal assistant, an interactive 3D knowledge graph, and a source-linked architecture map.

Medusae pins repositories to a commit, indexes source locally, and uses your chosen model to explain the code. The model supplies structured answers and maps; the application controls rendering and interaction.

This is an early release. Model reliability varies, repository coverage is bounded, and inferred graph relationships are not a complete runtime call graph.

## Start

Requires **Node.js 22.13 or newer** and **Git**. Node.js 24 LTS is recommended. A configured model provider is needed for AI answers and generated maps.

```sh
git clone https://github.com/eye9444/Medusae.git
cd Medusae
npm ci
npm run build
npm start
```

1. Open **Settings → K** to save provider keys, or use environment variables.
2. Choose separate chat and map models with **Settings → C / M**.
3. Select **New Chat** and paste a public repository URL using your terminal's paste shortcut, commonly Ctrl+Shift+V.
4. Ask questions, then use `/map` to open that chat's visual explorer.

Keep Medusae running while using the browser. The explorer runs on a local loopback address with an available port. After updating the app, run `npm ci` and `npm run build`, then restart it.

## What it does

- **Terminal chat:** prompt history, editing, command completion, progress indicators, output scrolling, and model selection.
- **3D knowledge graph:** coloured nodes, orbit/zoom, selection, and source inspection. Project-membership spokes are navigation links, not code dependencies.
- **Architecture view:** subsystem groups, source-file drill-down, and highlighted relationships.
- **Source viewer:** double-click a node to open its first available indexed source in a movable, resizable window.
- **Browser conversation:** saved answers and follow-ups, citation links, minimize/maximize controls, and synchronization with the selected TUI chat.
- **General explanations:** ask what a concept means without needing to know its implementation. Repository-specific claims use validated source references; general explanations use model knowledge.
- **Local sessions:** separate conversations and commit-pinned maps, cached answers, and deletion controls.
- **MCP:** a stdio `research_repo` tool for other assistants.

## Models and keys

Supported provider adapters include Gemini, OpenRouter, NVIDIA NIM, local Ollama, Ollama Cloud, and configurable OpenAI-compatible endpoints. Model availability, free tiers, quotas, and costs depend on your provider and account. Medusae does not supply credits or guarantee free inference.

OpenRouter defaults to `openrouter/free` when configured. Requests to that route retry up to five times after the initial attempt and do not fall back to Gemini. Mapping defaults to Gemini independently of chat. Use the Settings model pickers to override either default with a model available to your account.

For Ollama, run its server and install a local model first, then select it in Settings or enter `/model ollama <model-id>`. Cloud models served through Ollama require its sign-in and account access. A local Ollama server defaults to `http://127.0.0.1:11434/v1`; override with `OLLAMA_BASE_URL`.

### Encrypted local storage

In **Settings → K**, choose a provider and press Enter for masked key entry. **L** displays file locations, **Delete** removes one saved key, and **X** deletes the entire store after confirmation.

Default files:

- `~/.config/medusae/credentials.enc`: AES-256-GCM encrypted keys.
- `~/.config/medusae/credentials.key`: local unlock key for automatic access.

The directory uses owner-only permissions (700), and files use mode 600. **Anyone who can read both files can decrypt the keys.** This protects against casual plaintext exposure, not compromise of your user account. Deleting saved keys does not revoke them at the provider or unset environment variables.

`XDG_CONFIG_HOME` is respected. `MEDUSAE_CREDENTIALS_DIR` overrides the directory. Keys are used by the backend and are not sent to the browser.

### Environment configuration

Environment variables are optional and override saved keys:

| Provider | Key | Optional configuration |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY` | `MEDUSAE_GEMINI_MODEL`, `MEDUSAE_MAP_MODEL` |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` |
| NVIDIA | `NVIDIA_API_KEY` | `NVIDIA_MODEL` |
| Direct Ollama Cloud | `OLLAMA_API_KEY` | Select `ollama-cloud` and a model |
| Compatible endpoint | `MEDUSAE_COMPATIBLE_API_KEY` | `MEDUSAE_COMPATIBLE_BASE_URL`, `MEDUSAE_COMPATIBLE_MODEL` |

A saved Settings default takes precedence over automatic model selection. `/model <provider> <model-id>` changes the current terminal route temporarily. `/models` lists configured routes; Tab or Right Arrow accepts a command suggestion.

## Terminal controls

| Action | Control |
| --- | --- |
| Navigate menus | Up/Down or j/k; Enter selects |
| Recall prompts | Up/Down in chat |
| Move input cursor | Left/Right |
| Scroll transcript | Mouse wheel, Page Up/Down, Shift+Up/Down, Ctrl+Up/Down |
| Oldest/newest output | Ctrl+Home / Ctrl+End |
| Show complete typing answer | Enter |
| Open/rebuild map | `/map` / `/map rebuild` |
| Cancel or go back | Escape |
| Quit | Ctrl+C |

Use a terminal at least 52 columns by 20 rows. `NO_COLOR=1` disables colour; `MEDUSAE_REDUCED_MOTION=1` disables home-screen animation. Prompt recall expires after 24 hours by default (`MEDUSAE_PROMPT_HISTORY_TTL_MS`); saved chat messages remain until deleted.

## CLI and MCP

```sh
node src/cli.mjs doctor
node src/cli.mjs models
node src/cli.mjs open https://github.com/expressjs/cors
node src/cli.mjs ask https://github.com/expressjs/cors "How are preflight requests handled?" --json
npm run preview
npm run mcp
```

Example stdio MCP configuration; replace the path with your checkout's absolute path:

```json
{
  "mcpServers": {
    "medusae": {
      "command": "node",
      "args": ["/absolute/path/to/Medusae/src/mcp.mjs"]
    }
  }
}
```

`research_repo` accepts `repository`, `question`, and optional `sessionId`/`snapshotId`. It returns the answer summary, commit, citations, limitations, cache status, and model name. It may fetch repository source, write a local cache, and invoke your configured model. The TUI does not need to be running. Graph export and agent handoff are not currently exposed as MCP tools.

## Data and limitations

- A shallow bare clone is reused per repository. Chats, snapshots, indexes, reports, and caches live under `.medusae/` by default (`MEDUSAE_DATA_DIR` overrides it).
- Delete chats from **Continue Chat → Delete**. Shared repository data stays until its last chat is removed. SQLite can retain freed pages for reuse.
- Only public GitHub repository root URLs are supported. Medusae does not run cloned code, install its dependencies, or follow submodules.
- Default indexing limits: 2,000 files, 256 KiB per file, and 20 MiB of source. Generated maps use a selected subset of indexed files; large repositories can have incomplete coverage.
- Cloud providers receive selected repository excerpts and relevant conversation context. Local Ollama inference avoids sending that prompt to a cloud provider when a genuinely local model is selected.
- Map relationships can be inferred. Unresolved model source references cannot be opened. Answers can still be incomplete or mistaken despite citation validation.
- Rebuild refreshes the shared map data used by both visual views. A failed rebuild retains the previous report.
- This is a local tool, not a hardened multi-user web service. Do not expose its preview server publicly.

## Development

```sh
npm test
npm run build
```

The automated suite covers indexing, persistence, provider routing/retries, citations, general concept answers, credential encryption/deletion, and chat cleanup. Live-provider tests are opt-in. Browser interactions and terminal behavior need manual checks; a successful build is not a full UI test.

Built with Node.js, SQLite, Next.js, React Flow, Three.js/3D Force Graph, and the MCP SDK.

## License

No license has been selected for this initial release. Public visibility does not grant permission to reuse or redistribute the source beyond rights provided by GitHub's terms. Dependency licenses remain their respective authors' licenses.
