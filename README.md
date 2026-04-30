<div align="center">

# 🤖 AI Assistant for Joplin

**Bring Claude, GPT, and Perplexity directly into your note-taking workflow**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/artschekoff/joplin-ai/releases)
[![Joplin](https://img.shields.io/badge/Joplin-1.6+-1F2229.svg?logo=joplin)](https://joplinapp.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript)](https://typescriptlang.org)

*Edit smarter. Search faster. Think bigger.*

</div>

---

## 😩 Sound familiar?

- You spend more time **searching for that one note** than actually using it
- You copy-paste text into ChatGPT, edit there, then copy back — every. single. time.
- Your notes are a goldmine of knowledge, but **asking questions across hundreds of them** feels impossible
- You want AI to help organize, tag, and restructure your whole library — not just one file
- You switch apps constantly, **breaking your focus and flow**

**AI Assistant eliminates all of that.** It puts a full-featured AI agent right inside Joplin — one that can read, write, search, create, and organize your notes autonomously, while you stay in your editor.

---

## ✨ What it does

<table>
<tr>
<td width="50%">

### 💬 Chat with your notes
Ask questions, get summaries, extract insights — all from a side panel that knows exactly which note you're looking at.

</td>
<td width="50%">

### ✏️ Edit with precision
Request changes in plain language. Review every edit before it's applied — accept or reject individual changes, not just everything at once.

</td>
</tr>
<tr>
<td width="50%">

### 🕵️ Agent mode: full library access
The AI can search across all your notes, create new ones, move them between notebooks, add tags, and chain actions together — all from a single prompt.

</td>
<td width="50%">

### 🌐 Web search built in
Ask the AI to look something up while editing. Perplexity's Sonar models include native web search with citations — no browser tab switching needed.

</td>
</tr>
<tr>
<td width="50%">

### 🖼️ Generate and attach images
Describe an image and get it embedded directly into your note — diagrams, illustrations, covers, all without leaving Joplin.

</td>
<td width="50%">

### 📎 Attach files as context
PDF reports, code files, CSVs, logs — attach them to your message and the AI will read them as part of its context.

</td>
</tr>
</table>

---

## 🚀 Features

### 🤖 Three AI providers, one interface

| Provider | Models | Highlights |
|----------|--------|------------|
| **Anthropic Claude** | Opus 4, Sonnet 4, Haiku 3 | Best reasoning, great at long documents |
| **OpenAI GPT** | GPT-5.4, GPT-4.1, o3, o4-mini, GPT-4o | Widest model choice, o-series for deep reasoning |
| **Perplexity** | Sonar, Sonar Pro, Deep Research | Built-in web search with citations |

> Switch providers at any time. Your API keys are stored securely — never logged or shared.

---

### ⚙️ Three work modes

| Mode | What it can do |
|------|----------------|
| **Ask** 💬 | Read-only. Ask questions, get summaries, search your notes. Nothing is modified. |
| **Edit** ✏️ | Focused editing of the current note. The AI rewrites only what you ask, nothing else. |
| **Agent** 🕵️ | Full access: create, update, delete, move, tag, search, and chain actions across your entire library. |

---

### 🔄 Diff review — accept or reject individual changes

When the AI edits a note, you see an interactive diff view before anything is saved:

- **Green** = added lines, **Red** = removed lines
- Accept or reject **each group of changes independently**
- Apply accepted changes only — skip the rest
- Changes fade out as you decide, keeping the UI clean

No more "Accept All or nothing." You stay in control of every line.

---

### 🕵️ Agent tools

The AI agent has access to 15 tools to work with your Joplin library:

| Category | Tools |
|----------|-------|
| **Read** | `get_note`, `open_note`, `search_notes`, `list_notebooks`, `list_tags` |
| **Write** | `create_note`, `update_note`, `delete_note`, `move_note`, `create_notebook` |
| **Tags** | `add_tag`, `remove_tag` |
| **Search** | `web_search` (with citations) |
| **Media** | `generate_image`, `remove_resource` |

The search tool supports Joplin's full query syntax:

```
title:meeting tag:work created:day-7
"exact phrase" notebook:Projects -tag:archived
```

---

### 💰 Cost transparency

Every message shows a breakdown of token usage and USD cost — input, output, and cached tokens. Session totals accumulate in the footer. No surprises on your API bill.

---

### 🎭 Custom agent roles

Define reusable system prompts to shape the AI's behavior for specific tasks:

- **"Tech Writer"** — Rewrites notes in clear, concise documentation style
- **"Meeting Summarizer"** — Extracts action items and key decisions
- **"Researcher"** — Synthesizes information across multiple notes

Switch roles from the panel header. Create, edit, and delete roles from a built-in management UI.

---

## 📦 Installation

### From the Joplin Plugin Store

1. Open Joplin → **Tools → Options → Plugins**
2. Search for `AI Assistant`
3. Click **Install**
4. Restart Joplin

### Manual installation

1. Download the latest `.jpl` from the [Releases](https://github.com/artschekoff/joplin-ai/releases) page
2. In Joplin: **Tools → Options → Plugins → Install from file**
3. Select the downloaded `.jpl` file
4. Restart Joplin

---

## ⚙️ Setup

### 1. Open the AI panel

Press `Ctrl+Shift+A` (Windows/Linux) or `Cmd+Shift+A` (macOS), or click the robot icon in the toolbar.

### 2. Open settings

Click the ⚙️ gear icon in the panel header → **Settings**.

### 3. Add your API key

Choose a provider and paste your API key:

| Provider | Where to get a key |
|----------|--------------------|
| **Anthropic Claude** | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI GPT** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Perplexity** | [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api) |

### 4. (Optional) Enable image generation

Get a [Kie.ai](https://kie.ai) API key and paste it in settings. Then ask the AI to generate images.

### 5. Start chatting

Select a note, open the panel, and type your first message.

---

## 💡 Usage examples

```
"Summarize this note in 3 bullet points"

"Rewrite this in a more professional tone"

"Find all notes tagged 'project-x' and create a summary note"

"Generate a cover image for this article about machine learning"

"What did I write about Docker last month?"

"Add the tag 'reviewed' to all notes in my Work notebook"

"Search the web for the latest GPT-5 pricing and add it to this note"
```

---

## 🗂️ Supported file formats for attachments

PDF, TXT, MD, CSV, JSON, XML, JavaScript, TypeScript, Python, Java, C/C++, HTML, CSS, YAML, TOML, INI, SQL, Shell scripts, Go, Rust, Swift, Kotlin, Lua, Perl, PHP, Ruby, R, and more.

---

## 🏗️ Building from source

```bash
git clone https://github.com/artschekoff/joplin-ai
cd joplin-ai
npm install
npm run build
```

The compiled plugin will be in the `publish/` directory.

**Development mode** (watch + auto-reload):

```bash
npm run dev
```

**Run tests:**

```bash
npm test
```

---

## 📋 Changelog

### v1.0.0 — 2025-04

**Initial release.**

#### ✨ New features
- Side panel with full chat interface and streaming responses
- Support for **Anthropic Claude** (Opus 4, Sonnet 4, Haiku 3)
- Support for **OpenAI GPT** (GPT-5.4, GPT-4.1, o3, o4-mini, GPT-4o, and more)
- Support for **Perplexity** (Sonar, Sonar Pro, Deep Research, and routed models)
- Three work modes: **Ask**, **Edit**, **Agent**
- **Agent tools**: search, create, update, delete, move notes; add/remove tags; create notebooks
- **Diff review** with per-change Accept / Reject controls
- **Image generation** via Kie.ai (GPT Image 1.5, GPT-4o Image, Nano Banana Pro)
- **Web search** with citations (OpenAI search models + Perplexity Sonar)
- **File attachments** as AI context (PDF, code files, documents)
- **Custom agent roles** with system prompt editor
- **Cost tracking** per message and session total (tokens + USD)
- **Context size indicator** showing available token headroom
- **PDF text extraction** from attachments
- **Note references** — mention note titles in your prompt to include their content as context
- Chat history persistence (up to 50 messages)
- Secure API key storage
- CRLF encoding normalization to prevent spurious diffs
- Unicode whitespace normalization at AI boundaries

---

## 🤝 Contributing

Issues and pull requests are welcome. Please open an issue first to discuss major changes.

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Made with ☕ for Joplin power users who want more.

</div>
