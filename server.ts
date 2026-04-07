import express, { Request, Response } from "express";
import multer from "multer";
import * as pdf from "pdf-parse";
import mammoth from "mammoth";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MulterRequest extends Request {
  file?: any;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  const upload = multer({ storage: multer.memoryStorage() });

  // API Route for parsing documents
  app.post("/api/parse-document", upload.single("file"), async (req: any, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      let text = "";
      const buffer = req.file.buffer;
      const mimetype = req.file.mimetype;
      const originalname = req.file.originalname;

      if (mimetype === "application/pdf") {
        const data = await (pdf as any)(buffer);
        text = data.text;
      } else if (
        mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else if (mimetype === "text/plain") {
        text = buffer.toString("utf-8");
      } else {
        return res.status(400).json({ error: "Unsupported file type" });
      }

      // Simple chunking logic
      const chunks = chunkText(text, 1000, 200);
      
      res.json({ 
        fileName: originalname,
        chunks: chunks.map((content, index) => ({
          id: `${originalname}-${index}`,
          content,
          metadata: { source: originalname, page: Math.floor(index / 2) + 1 }
        }))
      });
    } catch (error) {
      console.error("Parsing error:", error);
      res.status(500).json({ error: "Failed to parse document" });
    }
  });

  // Simple chunking logic
  function chunkText(text: string, size: number, overlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + size, text.length);
      chunks.push(text.substring(start, end));
      start += size - overlap;
    }
    return chunks;
  }

  // Learning Loop: Store feedback
  const feedbackStore: any[] = [];
  app.post("/api/feedback", (req, res) => {
    const { logId, feedback, query, answer, confidenceScore, riskLevel, role } = req.body;
    const entry = {
      logId,
      feedback,
      query,
      answer,
      confidenceScore,
      riskLevel,
      role,
      timestamp: new Date()
    };
    feedbackStore.push(entry);
    console.log("Feedback received for learning loop:", entry);
    res.json({ status: "success" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
