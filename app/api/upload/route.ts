import { NextResponse } from "next/server";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { ingestDocument } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export async function POST(req: Request) {
  let tempPath: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 15 MB." }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (ext !== ".pdf" && ext !== ".txt") {
      return NextResponse.json(
        { error: "Only PDF or TXT files are allowed." },
        { status: 400 }
      );
    }

    // Persist to OS temp dir; PDFLoader needs a path on disk.
    const buffer = Buffer.from(await file.arrayBuffer());
    tempPath = path.join(os.tmpdir(), `uploaded_${Date.now()}${ext}`);
    await fs.writeFile(tempPath, buffer);

    // Per-document isolation via unique collection name.
    const collectionId = `doc_${crypto.randomUUID().replace(/-/g, "")}`;
    const { chunkCount } = await ingestDocument(tempPath, collectionId);

    return NextResponse.json({
      collectionId,
      fileName: file.name,
      chunkCount,
    });
  } catch (err: any) {
    console.error("[/api/upload] failed:", err);
    return NextResponse.json(
      { error: err?.message || "Ingestion failed." },
      { status: 500 }
    );
  } finally {
    if (tempPath) {
      try { await fs.unlink(tempPath); } catch {}
    }
  }
}
