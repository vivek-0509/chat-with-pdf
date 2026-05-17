import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { evaluateAndRefine, CragPath, CragGrade } from "./crag";

const GEMINI_MODEL = "gemini-2.5-flash";
const RETRIEVE_K = 8;

export interface QuerySource {
  page: number;
  snippet: string;
  grade: CragGrade;
  score: number;
}

export interface QueryResult {
  answer: string;
  sources: QuerySource[];
  cragPath: CragPath;
  cragEvaluations: Array<{ index: number; page: number; grade: CragGrade; score: number }>;
}

function buildSystemPrompt(
  chunks: Array<{ page: number; text: string }>
): string {
  const context = chunks
    .map((c, i) => `--- Chunk ${i + 1} (page ${c.page}) ---\n${c.text}`)
    .join("\n\n");

  return `You are a document-grounded question-answering assistant in a Corrective RAG (CRAG) pipeline.

The CONTEXT below has already been filtered and refined by a retrieval evaluator,
so trust it as the only authoritative source.

ABSOLUTE RULES (violating any is a critical failure):
1. Answer ONLY using facts present in the CONTEXT below.
2. If the answer is not in the CONTEXT, respond exactly: "I couldn't find that in the document."
3. Do NOT use prior knowledge, training data, or any external facts.
4. Do NOT speculate, infer beyond the text, or invent details.
5. Cite the page number for every factual claim using the format [p. N].
6. If the user asks anything off-topic (weather, unrelated code, opinions, etc.),
   refuse with rule #2's exact phrase.

CONTEXT (retrieved + CRAG-refined from the user's uploaded document):
${context}`;
}

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

  const retriever = vectorStore.asRetriever({ k: RETRIEVE_K });
  const searchedChunks = await retriever.invoke(question);

  if (!searchedChunks.length) {
    return {
      answer: "I couldn't find that in the document.",
      sources: [],
      cragPath: "refuse",
      cragEvaluations: [],
    };
  }

  const crag = await evaluateAndRefine(question, searchedChunks);

  const cragEvaluations = crag.evaluations.map((e) => ({
    index: e.index,
    page: (searchedChunks[e.index]?.metadata as any)?.pageNumber ?? 1,
    grade: e.grade,
    score: e.score,
  }));

  if (crag.path === "refuse" || crag.selected.length === 0) {
    return {
      answer: "I couldn't find that in the document.",
      sources: [],
      cragPath: "refuse",
      cragEvaluations,
    };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: buildSystemPrompt(crag.selected),
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  });

  const result = await model.generateContent(question);
  const answer = result.response.text().trim();

  const seen = new Set<number>();
  const sources: QuerySource[] = [];
  for (const c of crag.selected) {
    if (seen.has(c.page)) continue;
    seen.add(c.page);
    sources.push({
      page: c.page,
      snippet: c.text.slice(0, 240).replace(/\s+/g, " ").trim(),
      grade: c.grade,
      score: c.score,
    });
  }

  return { answer, sources, cragPath: crag.path, cragEvaluations };
}
