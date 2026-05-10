import { NextResponse } from "next/server";
import { queryDocument } from "@/lib/retriever";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { collectionId, question } = await req.json();

    if (!collectionId || typeof collectionId !== "string") {
      return NextResponse.json({ error: "collectionId is required." }, { status: 400 });
    }
    if (!question || typeof question !== "string" || !question.trim()) {
      return NextResponse.json({ error: "question is required." }, { status: 400 });
    }

    const result = await queryDocument(collectionId, question.trim());
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[/api/chat] failed:", err);
    return NextResponse.json(
      { error: err?.message || "Query failed." },
      { status: 500 }
    );
  }
}
