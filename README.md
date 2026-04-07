# Compliance Copilot - Production-Grade RAG MVP

## 🎯 Product Overview
Compliance Copilot is an AI-powered assistant designed to bridge the gap between complex internal policies and employee understanding. It leverages Retrieval-Augmented Generation (RAG) to provide accurate, cited answers from internal documents, reducing legal risk and HR overhead.

### Problem Statement
- **Information Overload**: Employees struggle to find specific rules in 100+ page PDFs.
- **Inconsistency**: Different HR reps might give different answers to the same policy question.
- **Audit Risk**: Lack of traceable decision logs for compliance-related queries.

## ⚙️ Technical Architecture

### 1. Ingestion Pipeline
- **Parsing**: Node.js backend using `pdf-parse` and `mammoth` to extract text from PDF, DOCX, and TXT.
- **Chunking**: Recursive character splitting (1000 chars with 200 char overlap) to preserve context.
- **Embedding**: Client-side embedding using `gemini-embedding-2-preview` via `@google/genai`.

### 2. Retrieval & Generation (RAG)
- **Vector Store**: In-memory vector storage in the browser for low-latency similarity search.
- **Search**: Cosine similarity calculation to find the top 10 candidate chunks.
- **Re-Ranking Layer (Advanced)**: A second-stage LLM-based re-ranker that evaluates the top 10 chunks for precise relevance before generation.
- **Generation**: Gemini 3 Flash model with a structured system prompt to ensure:
  - **Decision Mode**: Provides clear "Allowed", "Not Allowed", or "Risky" decisions.
  - **Role-Based Logic**: Tailors answers for 'Employee' (simple) vs. 'Legal' (detailed).
  - **Failure Handling**: Detects low confidence or missing context and suggests human consultation.

### 3. Advanced Features
- **Learning Loop**: Collects user feedback on answers and stores it in the backend for continuous retrieval improvement.
- **Performance Metrics**: Real-time tracking of latency (ms) and estimated inference cost ($) per query.
- **Confidence Scoring**: Real-time evaluation of how well the retrieved context matches the query.
- **Risk Flagging**: Automatic categorization of actions into Low, Medium, or High compliance risk.

## 📊 Evaluation Metrics

### Retrieval Quality
- **Precision@K**: How many of the top K retrieved chunks are actually relevant?
- **Recall@K**: Are all necessary pieces of information present in the top K chunks?

### Generation Quality
- **Faithfulness**: Does the answer contain information NOT present in the context? (Goal: 0%)
- **Answer Correctness**: Does the answer accurately reflect the policy?

### Product Metrics
- **Time Saved**: Average time for an employee to find an answer vs. manual search.
- **Success Rate**: % of queries where the user marked the answer as "Correct".

## 🧪 Experimentation & Tradeoffs
- **Re-ranking**: Currently using pure vector search. Adding a cross-encoder re-ranker would improve accuracy but increase latency.
- **Chunk Size**: Smaller chunks (500 chars) provide more granular retrieval but might lose broader context. Larger chunks (2000 chars) are better for complex legal clauses but consume more tokens.

## 🚀 Future Roadmap
1. **Role-Based Access Control (RBAC)**: Different answers for regular employees vs. Legal/HR admins.
2. **Multi-Document Reasoning**: Better handling of queries that span across multiple policies (e.g., HR + Finance).
3. **Integration**: Slack/Teams bot for real-time employee support.
