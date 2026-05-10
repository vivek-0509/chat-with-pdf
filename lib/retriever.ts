import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import type { Document } from "@langchain/core/documents";

const GEMINI_MODEL = "gemini-2.5-flash";

export interface QueryResult {
  answer: string;
  sources: Array<{ page: number; snippet: string }>;
}

/**
 * Strict, document-grounded system prompt. Rules + temperature 0.1 +
 * citation requirement combine to prevent answering from general knowledge.
 */
function buildSystemPrompt(chunks: Document[]): string {
  const context = chunks
    .map((c, i) => {
      const page = (c.metadata as any)?.pageNumber ?? "?";
      return `--- Chunk ${i + 1} (page ${page}) ---\n${c.pageContent}`;
    })
    .join("\n\n");

  return `You are a document-grounded question-answering assistant.

ABSOLUTE RULES (violating any is a critical failure):
1. Answer ONLY using facts present in the CONTEXT below.
2. If the answer is not in the CONTEXT, respond exactly: "I couldn't find that in the document."
3. Do NOT use prior knowledge, training data, or any external facts.
4. Do NOT speculate, infer beyond the text, or invent details.
5. Cite the page number for every factual claim using the format [p. N].
6. If the user asks anything off-topic (weather, unrelated code, opinions, etc.),
   refuse with rule #2's exact phrase.

CONTEXT (retrieved from the user's uploaded document):
${context}`;
}

/**
 * Query a previously-indexed document and produce a grounded answer.
 * Per-document isolation is guaranteed by the unique-collection-per-upload pattern.
 */
export async function queryDocument(
  collectionId: string,
  question: string
): Promise<QueryResult> {
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GEMINI_API_KEY!,
    model: "gemini-embedding-001",
    taskType: TaskType.RETRIEVAL_QUERY,
  });

  const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
    url: process.env.QDRANT_URL!,
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: collectionId,
  });

  const retriever = vectorStore.asRetriever({ k: 5 });
  const searchedChunks = await retriever.invoke(question);

  if (!searchedChunks.length) {
    return { answer: "I couldn't find that in the document.", sources: [] };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: buildSystemPrompt(searchedChunks),
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  });

  const result = await model.generateContent(question);
  const answer = result.response.text().trim();

  const seen = new Set<number>();
  const sources: QueryResult["sources"] = [];
  for (const c of searchedChunks) {
    const page = (c.metadata as any)?.pageNumber ?? 1;
    if (seen.has(page)) continue;
    seen.add(page);
    sources.push({
      page,
      snippet: c.pageContent.slice(0, 240).replace(/\s+/g, " ").trim(),
    });
  }

  return { answer, sources };
}
