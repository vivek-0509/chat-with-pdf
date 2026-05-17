"use client";

import { useEffect, useRef, useState } from "react";

type CragGrade = "correct" | "ambiguous" | "incorrect";
type CragPath = "correct" | "ambiguous" | "refuse";

interface Source { page: number; snippet: string; grade?: CragGrade; score?: number; }
interface ChatMessage {
  role: "user" | "bot";
  text?: string;
  sources?: Source[];
  cragPath?: CragPath;
  error?: string;
  loading?: boolean;
  notFound?: boolean;
}

const CRAG_PATH_LABEL: Record<CragPath, string> = {
  correct: "CRAG: Direct match",
  ambiguous: "CRAG: Refined",
  refuse: "CRAG: Not in document",
};

const PROCESS_STEPS = ["Chunking", "Embedding", "Indexing"] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Home() {
  // ---- State (unchanged: collectionId is preserved) ----
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [docName, setDocName] = useState<string>("");
  const [chunkCount, setChunkCount] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [question]);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus chat input after upload succeeds
  useEffect(() => {
    if (collectionId) textareaRef.current?.focus();
  }, [collectionId]);

  // Animate the processing step labels
  useEffect(() => {
    if (!uploading) return;
    setStepIndex(0);
    const id = setInterval(() => {
      setStepIndex((s) => (s + 1) % PROCESS_STEPS.length);
    }, 1500);
    return () => clearInterval(id);
  }, [uploading]);

  // ---- File handling ----
  function pickFile(f: File | null) {
    setUploadError(null);
    if (!f) { setFile(null); return; }
    const ok = /\.(pdf|txt)$/i.test(f.name) || f.type === "application/pdf" || f.type === "text/plain";
    if (!ok) { setUploadError("Only PDF or TXT files are allowed."); return; }
    if (f.size > 15 * 1024 * 1024) { setUploadError("File exceeds 15 MB."); return; }
    setFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (collectionId) return;
    pickFile(e.dataTransfer.files?.[0] ?? null);
  }

  // ---- API: upload (UNCHANGED endpoint + payload) ----
  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setUploadError(null);

    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setCollectionId(data.collectionId);
      setDocName(data.fileName);
      setChunkCount(data.chunkCount);
      setMessages([]);
    } catch (err: any) {
      setUploadError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function handleReset() {
    setCollectionId(null);
    setDocName("");
    setChunkCount(0);
    setFile(null);
    setMessages([]);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ---- API: chat (UNCHANGED endpoint + payload) ----
  async function handleAsk() {
    const q = question.trim();
    if (!q || !collectionId || asking) return;

    const userMsg: ChatMessage = { role: "user", text: q };
    const loadingMsg: ChatMessage = { role: "bot", loading: true };
    setMessages((m) => [...m, userMsg, loadingMsg]);
    setQuestion("");
    setAsking(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Query failed.");

      const notFound = typeof data.answer === "string" &&
        data.answer.toLowerCase().includes("couldn't find");

      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: "bot",
          text: data.answer,
          sources: data.sources || [],
          cragPath: data.cragPath,
          notFound,
        };
        return next;
      });
    } catch (err: any) {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "bot", error: err.message };
        return next;
      });
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="shell">
      {/* ===== LEFT PANEL ===== */}
      <aside className={`panel left ${collectionId ? "compact" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 014 17.5v-13z" />
              <path d="M4 17.5A2.5 2.5 0 016.5 15H20" />
              <path d="M9 7h7" />
              <path d="M9 11h5" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-name">Chat with PDF</div>
            <div className="brand-sub">Gemini · Qdrant · RAG</div>
          </div>
        </div>

        <div
          className={`dropzone ${dragging ? "dragging" : ""} ${file || collectionId ? "has-file" : ""}`}
          onClick={() => !collectionId && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (!collectionId) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            disabled={!!collectionId}
          />

          {!file && !collectionId && (
            <>
              <svg className="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 16l-4-4-4 4" />
                <path d="M12 12v9" />
                <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
                <path d="M16 16l-4-4-4 4" />
              </svg>
              <div className="dz-title">Drag &amp; drop your PDF or TXT file</div>
              <div className="dz-sub">or click to browse</div>
              <div className="dz-hint">PDF or TXT · max 15 MB</div>
            </>
          )}

          {(file || collectionId) && (
            <div className="file-card">
              <div className="file-icon">{(collectionId ? docName : file!.name).toLowerCase().endsWith(".pdf") ? "PDF" : "TXT"}</div>
              <div className="file-meta">
                <div className="file-name">{collectionId ? docName : file!.name}</div>
                <div className="file-size">
                  {collectionId ? `${chunkCount} chunks indexed` : formatBytes(file!.size)}
                </div>
              </div>
              {!collectionId && !uploading && (
                <button
                  className="file-clear"
                  aria-label="Remove file"
                  onClick={(e) => { e.stopPropagation(); pickFile(null); }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {!collectionId && (
          <button className="btn" onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? <><span className="spinner" /> Processing…</> : "Process Document"}
          </button>
        )}

        {collectionId && (
          <div className="reset-row">
            <button className="btn ghost" onClick={handleReset}>Change Document</button>
          </div>
        )}

        {/* Status card */}
        {uploading && (
          <div className="status-card">
            <div className="status-row">
              <div className="spinner" style={{ borderColor: "rgba(124,111,247,0.3)", borderTopColor: "var(--accent)" }} />
              <div className="status-text muted">{PROCESS_STEPS[stepIndex]}…</div>
            </div>
            <div className="progress-track"><div className="progress-fill" /></div>
            <div className="progress-steps">
              {PROCESS_STEPS.map((s, i) => (
                <span
                  key={s}
                  className={`progress-step ${i === stepIndex ? "active" : ""} ${i < stepIndex ? "done" : ""}`}
                >
                  {i > 0 && "· "}{s}
                </span>
              ))}
            </div>
          </div>
        )}

        {!uploading && collectionId && (
          <div className="status-card success">
            <div className="status-row">
              <svg className="status-icon" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <div className="status-text ok">Document ready! Ask anything.</div>
            </div>
          </div>
        )}

        {!uploading && uploadError && (
          <div className="status-card error">
            <div className="status-row">
              <svg className="status-icon" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="status-text err">{uploadError}</div>
            </div>
          </div>
        )}
      </aside>

      {/* ===== RIGHT PANEL ===== */}
      <main className="panel right">
        <div className="chat-header">
          <h1 className="chat-title">Chat with your Document</h1>
          {collectionId && (
            <span className="doc-badge" title={docName}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="name">{docName}</span>
            </span>
          )}
        </div>

        <div className="chat-log">
          {messages.length === 0 && (
            <div className="empty">
              <div className="empty-art">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                  <circle cx="9" cy="10" r="0.6" fill="currentColor" />
                  <circle cx="12" cy="10" r="0.6" fill="currentColor" />
                  <circle cx="15" cy="10" r="0.6" fill="currentColor" />
                </svg>
              </div>
              <div className="empty-title">
                {collectionId ? "Ask anything about your document" : "Upload a document to start chatting"}
              </div>
              <div>
                {collectionId
                  ? "Try: \"Summarize this document\" or \"What is the main argument?\""
                  : "Your questions will be answered strictly from the content you upload."}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === "bot" && (
                <div className={`avatar ${m.notFound ? "warn" : ""}`}>
                  {m.notFound ? "!" : "AI"}
                </div>
              )}
              <div className="msg-bubble">
                {m.loading ? (
                  <div className="typing"><span /><span /><span /></div>
                ) : m.error ? (
                  <span style={{ color: "var(--error)" }}>✗ {m.error}</span>
                ) : (
                  <>
                    <div>{m.text}</div>
                    {m.cragPath && (
                      <div className={`crag-badge crag-${m.cragPath}`}>
                        <span className="crag-dot" />
                        {CRAG_PATH_LABEL[m.cragPath]}
                      </div>
                    )}
                    {m.sources && m.sources.length > 0 && (
                      <details className="sources">
                        <summary>Sources ({m.sources.length})</summary>
                        <div className="source-pills">
                          {m.sources.map((s, j) => (
                            <span key={j} className={`pill ${s.grade ? `pill-${s.grade}` : ""}`}>
                              📄 p. {s.page}
                              {typeof s.score === "number" && (
                                <span className="pill-score">{Math.round(s.score * 100)}</span>
                              )}
                            </span>
                          ))}
                        </div>
                        {m.sources.map((s, j) => (
                          <div key={j} className="source-snip">
                            <strong style={{ color: "var(--text)" }}>p. {s.page}</strong> - {s.snippet}…
                          </div>
                        ))}
                      </details>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="composer">
          <div className="composer-row">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={collectionId ? "Ask a question about your document..." : "Upload a document first..."}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAsk();
                }
              }}
              disabled={!collectionId || asking}
            />
            <button
              className="send-btn"
              onClick={handleAsk}
              disabled={!collectionId || !question.trim() || asking}
              aria-label="Send"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div className="composer-hint">
            Press <strong>Enter</strong> to send · <strong>Shift+Enter</strong> for new line
          </div>
        </div>
      </main>
    </div>
  );
}
