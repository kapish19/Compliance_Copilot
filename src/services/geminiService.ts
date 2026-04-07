import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface DocumentChunk {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    source: string;
    page?: number;
  };
}

export interface ComplianceResult {
  decision: 'Allowed' | 'Not Allowed' | 'Risky' | 'Inconclusive';
  answer: string;
  citations: string[];
  confidenceScore: number;
  riskLevel: 'Low' | 'Medium' | 'High';
  riskExplanation: string;
  keyExcerpts: string[];
  isFailure: boolean;
  failureReason?: string;
  suggestedAction?: string;
}

export async function embedText(text: string): Promise<number[]> {
  const result = await ai.models.embedContent({
    model: "gemini-embedding-2-preview",
    contents: [text],
  });
  return result.embeddings[0].values;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Re-ranks retrieved chunks using the LLM to ensure the most relevant context is used.
 */
export async function reRankChunks(query: string, chunks: DocumentChunk[]): Promise<DocumentChunk[]> {
  if (chunks.length <= 1) return chunks;

  const prompt = `
    Query: ${query}
    
    Context Chunks:
    ${chunks.map((c, i) => `[ID: ${i}] ${c.content}`).join("\n---\n")}
    
    Task: Re-rank these chunks by relevance to the query. Return only a JSON array of indices in order of most relevant to least relevant.
    Example: [2, 0, 1]
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    }
  });

  try {
    const indices: number[] = JSON.parse(response.text);
    return indices.map(idx => chunks[idx]).filter(Boolean);
  } catch (e) {
    console.error("Re-ranking failed, falling back to original order", e);
    return chunks;
  }
}

export async function generateAnswer(
  query: string, 
  context: DocumentChunk[], 
  role: 'employee' | 'legal' = 'employee'
): Promise<ComplianceResult> {
  const contextText = context.map(c => `[Source: ${c.metadata.source}] ${c.content}`).join("\n\n");
  
  const systemInstruction = `
    You are Compliance Copilot, an expert decision support system for corporate compliance.
    
    User Role: ${role}
    
    Your primary task is to make a DECISION based on the provided context.
    
    Decision Types:
    - Allowed: The action is clearly permitted by policy.
    - Not Allowed: The action is clearly forbidden.
    - Risky: The action is permitted but with significant conditions or potential issues.
    - Inconclusive: The context does not provide enough information to make a decision.
    
    Role-Based Tailoring:
    - If role is 'employee': Provide a clear, simple answer. Focus on "What should I do?".
    - If role is 'legal': Provide a detailed analysis, citing specific clauses and potential legal nuances.
    
    Failure Handling:
    - If confidence is below 60% or context is missing, set "isFailure": true and "suggestedAction": "Please consult HR/Legal directly".
    - Detect ambiguous queries and ask for clarification if needed.
    
    Output format (JSON):
    {
      "decision": "Allowed" | "Not Allowed" | "Risky" | "Inconclusive",
      "answer": "...",
      "citations": ["..."],
      "confidenceScore": 0-100,
      "riskLevel": "Low" | "Medium" | "High",
      "riskExplanation": "...",
      "keyExcerpts": ["..."],
      "isFailure": boolean,
      "failureReason": "...",
      "suggestedAction": "..."
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Context:\n${contextText}\n\nQuery: ${query}`,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
    }
  });

  return JSON.parse(response.text);
}
