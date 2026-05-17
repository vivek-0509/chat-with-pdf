import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Document } from "@langchain/core/documents";

const EVALUATOR_MODEL = "gemini-2.5-flash";

export type CragGrade = "correct" | "ambiguous" | "incorrect";
export type CragPath = "correct" | "ambiguous" | "refuse";

export interface ChunkEvaluation {
  index: number;
  grade: CragGrade;
  score: number;
  relevant_excerpt: string;
}

export interface CragResult {
  path: CragPath;
  selected: Array<{
    page: number;
    text: string;
    grade: CragGrade;
    score: number;
  }>;
  evaluations: ChunkEvaluation[];
}

const UPPER_THRESHOLD = 0.7;
const LOWER_THRESHOLD = 0.3;

function buildEvaluatorPrompt(question: string, chunks: Document[]): string {
  const numbered = chunks
    .map((c, i) => {
      const page = (c.metadata as any)?.pageNumber ?? "?";
      return `[Chunk ${i}] (page ${page})\n${c.pageContent}`;
    })
    .join("\n\n");

  return `You are a strict retrieval evaluator for a Corrective RAG (CRAG) pipeline.

For each retrieved chunk below, judge how well it can answer the user's QUESTION on its own.

Grades:
- "correct"   : chunk clearly contains a direct answer or strong supporting evidence.
- "ambiguous" : chunk is on-topic but only partially relevant, or needs other chunks to answer.
- "incorrect" : chunk is off-topic, contradictory, or contains no usable evidence.

Also return a calibrated relevance score in [0, 1] (1 = perfect match, 0 = unrelated).

For "correct" and "ambiguous" chunks, return relevant_excerpt = the smallest verbatim
substring of the chunk that contains the useful evidence (do NOT paraphrase, do NOT add
new words). For "incorrect" chunks, return relevant_excerpt = "".

Respond with a JSON array, one object per chunk, in chunk order. No prose, no markdown.

QUESTION: ${question}

CHUNKS:
${numbered}

Schema for each object:
{ "index": number, "grade": "correct"|"ambiguous"|"incorrect", "score": number, "relevant_excerpt": string }`;
}

function safeParseEvaluations(raw: string, expectedCount: number): ChunkEvaluation[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Evaluator did not return an array");

  const byIndex = new Map<number, ChunkEvaluation>();
  for (const item of parsed) {
    if (typeof item?.index !== "number") continue;
    const grade: CragGrade =
      item.grade === "correct" || item.grade === "ambiguous" || item.grade === "incorrect"
        ? item.grade
        : "incorrect";
    const score = Math.max(0, Math.min(1, Number(item.score) || 0));
    byIndex.set(item.index, {
      index: item.index,
      grade,
      score,
      relevant_excerpt: typeof item.relevant_excerpt === "string" ? item.relevant_excerpt : "",
    });
  }

  const out: ChunkEvaluation[] = [];
  for (let i = 0; i < expectedCount; i++) {
    out.push(
      byIndex.get(i) ?? { index: i, grade: "incorrect", score: 0, relevant_excerpt: "" }
    );
  }
  return out;
}

export async function evaluateAndRefine(
  question: string,
  chunks: Document[]
): Promise<CragResult> {
  if (chunks.length === 0) {
    return { path: "refuse", selected: [], evaluations: [] };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: EVALUATOR_MODEL,
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
    },
  });

  const prompt = buildEvaluatorPrompt(question, chunks);
  const res = await model.generateContent(prompt);
  const raw = res.response.text();

  let evaluations: ChunkEvaluation[];
  try {
    evaluations = safeParseEvaluations(raw, chunks.length);
  } catch {
    evaluations = chunks.map((_, i) => ({
      index: i,
      grade: "ambiguous",
      score: 0.5,
      relevant_excerpt: "",
    }));
  }

  const maxScore = evaluations.reduce((m, e) => Math.max(m, e.score), 0);
  let path: CragPath;
  if (maxScore >= UPPER_THRESHOLD) path = "correct";
  else if (maxScore >= LOWER_THRESHOLD) path = "ambiguous";
  else path = "refuse";

  const selected: CragResult["selected"] = [];
  if (path === "correct") {
    evaluations
      .filter((e) => e.grade === "correct" || e.score >= UPPER_THRESHOLD)
      .forEach((e) => {
        const c = chunks[e.index];
        if (!c) return;
        selected.push({
          page: (c.metadata as any)?.pageNumber ?? 1,
          text: c.pageContent,
          grade: e.grade,
          score: e.score,
        });
      });
  } else if (path === "ambiguous") {
    evaluations
      .filter((e) => e.score >= LOWER_THRESHOLD)
      .forEach((e) => {
        const c = chunks[e.index];
        if (!c) return;
        const refined = e.relevant_excerpt && e.relevant_excerpt.length > 20
          ? e.relevant_excerpt
          : c.pageContent;
        selected.push({
          page: (c.metadata as any)?.pageNumber ?? 1,
          text: refined,
          grade: e.grade,
          score: e.score,
        });
      });
  }

  return { path, selected, evaluations };
}
