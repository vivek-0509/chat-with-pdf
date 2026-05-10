# 📓 NotebookLLM (Next.js) — Chat With Your Documents

A Google NotebookLM-style RAG application built on **Next.js (App Router)**. Upload a PDF or TXT, ask questions in natural language, and get answers grounded **strictly** in the document — citations included.

- **Framework:** Next.js 15 (App Router) + TypeScript
- **LLM:** Google Gemini (`gemini-2.5-flash`)
- **Embeddings:** Google `gemini-embedding-001` (3072-dim)
- **Vector DB:** Qdrant Cloud

---

## ✨ Features

- 📤 PDF / TXT upload via the browser
- 🔍 Full RAG pipeline: chunk → embed → store → retrieve → generate
- 🧠 **Per-document isolation** — each upload gets its own Qdrant collection
- 📄 **Page citations** for every answer
- 🛑 **Hallucination-resistant** — refuses to answer outside document scope

---

## 🗂️ Project Structure

```
.
├── app/
│   ├── layout.tsx
│   ├── page.tsx                # client UI: upload + chat
│   ├── globals.css
│   └── api/
│       ├── upload/route.ts     # POST /api/upload
│       └── chat/route.ts       # POST /api/chat
├── lib/
│   ├── ingest.ts               # chunking + embedding + Qdrant upsert
│   └── retriever.ts            # vector search + Gemini grounded generation
├── package.json
├── next.config.mjs
├── tsconfig.json
├── .env.local                  # your secrets (git-ignored)
└── .env.example
```

---

## ⚙️ Setup

### 1. Prerequisites

- Node.js **20+**
- A free **Gemini API key** → https://aistudio.google.com/apikey
- A free **Qdrant Cloud** cluster → https://cloud.qdrant.io/

### 2. Install

```bash
npm install
cp .env.example .env.local
```

### 3. Configure `.env.local`

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | API key from Google AI Studio (used for embeddings + generation). |
| `QDRANT_URL` | Qdrant Cloud cluster URL (e.g. `https://xxxxx.qdrant.io:6333`). |
| `QDRANT_API_KEY` | API key for the Qdrant cluster. |
| `PORT` | Optional, defaults to `3000`. |

### 4. Run

```bash
npm run dev
# → http://localhost:3000
```

For production:
```bash
npm run build
npm start
```

---

## 🧬 RAG Pipeline

| Stage | Tool | Detail |
|---|---|---|
| **Load** | `PDFLoader` / `TextLoader` | One Document per page (PDFs) so page numbers propagate. |
| **Chunk** | `RecursiveCharacterTextSplitter` | `chunkSize: 500`, `chunkOverlap: 100` |
| **Embed** | `gemini-embedding-001` (Google) | `RETRIEVAL_DOCUMENT` for indexing, `RETRIEVAL_QUERY` for queries (asymmetric → better recall) |
| **Store** | Qdrant Cloud | One collection per document (`doc_<uuid>`) — guarantees isolation |
| **Retrieve** | Cosine similarity | Top **k=5** chunks |
| **Generate** | `gemini-2.5-flash`, temperature 0.1 | Strict system prompt enforces document-only answers |

### Chunking strategy — why 500/100?

The `RecursiveCharacterTextSplitter` is configured with chunk size **500 characters** and **100 char overlap** (~20%). Splits priority: `["\n\n", "\n", ". ", " ", ""]`.

- Smaller chunks → higher precision at retrieval time.
- 20% overlap prevents context loss at chunk boundaries.
- The recursive separator list almost never splits mid-sentence.

### Hallucination prevention (4 layers)

1. **Strict system prompt** with absolute rules + explicit refusal phrase: `"I couldn't find that in the document."`
2. **Temperature 0.1** — near-deterministic generation.
3. **Per-document collection** — query for doc A literally cannot retrieve doc B's vectors.
4. **Citations rendered in UI** — every claim is verifiable.

---

## 🔌 API Reference

### `POST /api/upload`

multipart/form-data, field `file` (PDF or TXT, ≤ 15 MB).

```json
{ "collectionId": "doc_abc123…", "fileName": "node.pdf", "chunkCount": 142 }
```

### `POST /api/chat`

```json
{ "collectionId": "doc_abc123…", "question": "What is the event loop?" }
```

Response:
```json
{
  "answer": "The event loop is... [p. 4]",
  "sources": [
    { "page": 4, "snippet": "The event loop is what allows Node.js..." }
  ]
}
```

---

## 🚀 Deployment

### Vercel (recommended)

1. Push this repo to GitHub.
2. Import the repo on [vercel.com](https://vercel.com/).
3. Add env vars: `GEMINI_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`.
4. Deploy.

> **Vercel function note:** PDF parsing on large files can exceed the 10s default timeout. The route handlers set `maxDuration = 60`; on the Hobby tier that maps to 60s, which is enough for assignment-scale documents.

### Qdrant Cloud

The free tier (1 GB cluster, no credit card) is sufficient. Just paste the URL + API key into Vercel's env vars.

---

## 🛡️ Notes & Limitations

- Uploaded files are written to `os.tmpdir()` and deleted after ingestion.
- Each document creates a new Qdrant collection. Add a cleanup job if you expect heavy use.
- Scanned PDFs without a text layer won't extract text — OCR is out of scope.
- No auth — anyone with the URL can upload. Add auth before exposing publicly.

---

## 📜 License

MIT
