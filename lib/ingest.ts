import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { TaskType } from "@google/generative-ai";
import path from "path";

/**
 * Embedding model: Google `gemini-embedding-001` (3072-dim).
 * Same vendor as Gemini (one API key), generous free tier, and supports
 * asymmetric task types (RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY) which
 * measurably improves recall over symmetric models like OpenAI's.
 */
function buildEmbeddings(taskType: TaskType) {
  return new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY!,
    model: "gemini-embedding-001",
    taskType,
  });
}

export interface IngestResult {
  chunkCount: number;
}

/**
 * Ingest a single document into a fresh Qdrant collection.
 * Pipeline: load → split (500/100) → embed → upsert.
 */
export async function ingestDocument(
  filePath: string,
  collectionId: string
): Promise<IngestResult> {
  const ext = path.extname(filePath).toLowerCase();

  let docs;
  if (ext === ".pdf") {
    docs = await new PDFLoader(filePath).load();
  } else if (ext === ".txt") {
    docs = await new TextLoader(filePath).load();
    docs = docs.map((d) => ({
      ...d,
      metadata: { ...d.metadata, loc: { pageNumber: 1 } },
    }));
  } else {
    throw new Error(`Unsupported file type: ${ext}. Only .pdf and .txt allowed.`);
  }

  if (!docs.length) throw new Error("Document is empty or could not be parsed.");

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
    separators: ["\n\n", "\n", ". ", " ", ""],
  });
  const chunks = await splitter.splitDocuments(docs);

  const enriched = chunks.map((c, i) => ({
    ...c,
    metadata: {
      ...c.metadata,
      pageNumber: (c.metadata as any)?.loc?.pageNumber ?? 1,
      chunkIndex: i,
    },
  }));

  const embeddings = buildEmbeddings(TaskType.RETRIEVAL_DOCUMENT);
  await QdrantVectorStore.fromDocuments(enriched, embeddings, {
    url: process.env.QDRANT_URL!,
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: collectionId,
  });

  return { chunkCount: enriched.length };
}
