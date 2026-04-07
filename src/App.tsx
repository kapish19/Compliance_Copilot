import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  MessageSquare, 
  ShieldCheck, 
  FileText, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  Loader2,
  Send,
  ChevronRight,
  History,
  Info,
  Zap,
  DollarSign,
  UserCircle,
  Scale
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import { 
  embedText, 
  cosineSimilarity, 
  generateAnswer, 
  reRankChunks,
  type DocumentChunk,
  type ComplianceResult
} from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  data?: ComplianceResult;
  timestamp: Date;
  metrics?: {
    latency: number;
    cost: number;
  };
}

interface AuditLog {
  id: string;
  query: string;
  answer: string;
  riskLevel: string;
  decision: string;
  timestamp: Date;
  feedback?: 'correct' | 'incorrect';
  role: string;
  metrics: {
    latency: number;
    cost: number;
  };
}

export default function App() {
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'audit' | 'checker'>('chat');
  const [checkerResult, setCheckerResult] = useState<ComplianceResult | null>(null);
  const [userRole, setUserRole] = useState<'employee' | 'legal'>('employee');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Performance metrics
  const [totalCost, setTotalCost] = useState(0);
  const [avgLatency, setAvgLatency] = useState(0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/parse-document', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);

      // Embed chunks in frontend
      const embeddedChunks = await Promise.all(
        data.chunks.map(async (chunk: any) => ({
          ...chunk,
          embedding: await embedText(chunk.content)
        }))
      );

      setChunks(prev => [...prev, ...embeddedChunks]);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Successfully indexed **${file.name}**. I'm ready to answer questions about it.`,
        timestamp: new Date()
      }]);
    } catch (err) {
      console.error(err);
      alert('Failed to upload and index document.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const startTime = Date.now();
    const userQuery = input;
    const currentTab = activeTab;
    
    if (currentTab === 'chat') {
      setInput('');
    }
    
    setIsProcessing(true);

    if (currentTab === 'chat') {
      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: userQuery,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMsg]);
    } else if (currentTab === 'checker') {
      setCheckerResult(null);
    }

    try {
      if (chunks.length === 0) {
        throw new Error("No documents indexed. Please upload a policy first.");
      }

      // 1. Embed query
      const queryEmbedding = await embedText(userQuery);

      // 2. Vector Search (Cosine Similarity)
      const similarities = chunks.map(chunk => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding!)
      }));

      // Retrieve top 10 for re-ranking
      const candidateChunks = similarities
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(s => s.chunk);

      // 3. Re-Ranking Layer (High Technical Signal)
      const topContext = await reRankChunks(userQuery, candidateChunks);
      const finalContext = topContext.slice(0, 5);

      // 4. Generate Answer with Decision Support
      const result = await generateAnswer(userQuery, finalContext, userRole);

      const latency = Date.now() - startTime;
      const estimatedCost = 0.0001 * (finalContext.length + 1); // Mock cost calculation

      if (currentTab === 'chat') {
        const assistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: result.answer,
          data: result,
          timestamp: new Date(),
          metrics: { latency, cost: estimatedCost }
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else if (currentTab === 'checker') {
        setCheckerResult(result);
      }

      // 5. Add to Audit Log (Learning Loop)
      const log: AuditLog = {
        id: Math.random().toString(36).substr(2, 9),
        query: userQuery,
        answer: result.answer,
        riskLevel: result.riskLevel,
        decision: result.decision,
        timestamp: new Date(),
        role: userRole,
        metrics: { latency, cost: estimatedCost }
      };
      setAuditLogs(prev => [log, ...prev]);

      // Update global metrics
      setTotalCost(prev => prev + estimatedCost);
      setAvgLatency(prev => auditLogs.length === 0 ? latency : (prev * auditLogs.length + latency) / (auditLogs.length + 1));

    } catch (err: any) {
      if (currentTab === 'chat') {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `Error: ${err.message}`,
          timestamp: new Date()
        }]);
      } else {
        alert(err.message);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFeedback = async (logId: string, feedback: 'correct' | 'incorrect') => {
    const log = auditLogs.find(l => l.id === logId);
    if (!log) return;

    setAuditLogs(prev => prev.map(l => 
      l.id === logId ? { ...l, feedback } : l
    ));

    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logId,
          feedback,
          query: log.query,
          answer: log.answer,
          riskLevel: log.riskLevel,
          role: log.role
        }),
      });
    } catch (err) {
      console.error("Failed to send feedback to learning loop", err);
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-2 text-indigo-600 font-bold text-xl">
            <ShieldCheck className="w-8 h-8" />
            <span>Copilot</span>
          </div>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-semibold">Compliance MVP</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <div className="mb-6 px-4 py-3 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
              <UserCircle className="w-3 h-3" /> User Role
            </p>
            <div className="flex bg-white p-1 rounded-lg border border-slate-200">
              <button 
                onClick={() => setUserRole('employee')}
                className={cn(
                  "flex-1 text-[10px] font-bold py-1.5 rounded-md transition-all",
                  userRole === 'employee' ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                Employee
              </button>
              <button 
                onClick={() => setUserRole('legal')}
                className={cn(
                  "flex-1 text-[10px] font-bold py-1.5 rounded-md transition-all",
                  userRole === 'legal' ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                Legal
              </button>
            </div>
          </div>

          <button 
            onClick={() => setActiveTab('chat')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              activeTab === 'chat' ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-500 hover:bg-slate-50"
            )}
          >
            <MessageSquare className="w-5 h-5" />
            <span>Chat Assistant</span>
          </button>
          <button 
            onClick={() => setActiveTab('checker')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              activeTab === 'checker' ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-500 hover:bg-slate-50"
            )}
          >
            <AlertTriangle className="w-5 h-5" />
            <span>Risk Checker</span>
          </button>
          <button 
            onClick={() => setActiveTab('audit')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all",
              activeTab === 'audit' ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-500 hover:bg-slate-50"
            )}
          >
            <History className="w-5 h-5" />
            <span>Audit Trail</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="bg-slate-50 rounded-xl p-4">
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Knowledge Base</h4>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {chunks.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No documents indexed</p>
              ) : (
                Array.from(new Set(chunks.map(c => c.metadata.source))).map(source => (
                  <div key={source} className="flex items-center gap-2 text-xs text-slate-600 bg-white p-2 rounded border border-slate-200">
                    <FileText className="w-3 h-3 text-indigo-400" />
                    <span className="truncate">{source}</span>
                  </div>
                ))
              )}
            </div>
            <label className="mt-4 block w-full">
              <div className={cn(
                "flex items-center justify-center gap-2 p-3 border-2 border-dashed rounded-xl cursor-pointer transition-all",
                isUploading ? "bg-slate-100 border-slate-300" : "border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/50"
              )}>
                {isUploading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-indigo-500" />
                    <span className="text-sm font-medium text-indigo-600">Upload Policy</span>
                  </>
                )}
              </div>
              <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.txt" disabled={isUploading} />
            </label>

            <div className="mt-6 pt-6 border-t border-slate-100 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-400">
                  <Zap className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase">Avg Latency</span>
                </div>
                <span className="text-xs font-mono font-bold text-slate-600">{Math.round(avgLatency)}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-400">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase">Total Cost</span>
                </div>
                <span className="text-xs font-mono font-bold text-slate-600">${totalCost.toFixed(4)}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-white">
        <header className="h-16 border-b border-slate-100 flex items-center justify-between px-8">
          <h2 className="font-semibold text-slate-700 capitalize">
            {activeTab === 'chat' ? 'Policy Q&A' : activeTab === 'checker' ? 'Compliance Risk Assessment' : 'Audit Logs'}
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium border border-green-100">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              System Active
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'chat' && (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-3xl mx-auto space-y-6 pb-24"
              >
                {messages.length === 0 && (
                  <div className="text-center py-20">
                    <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <ShieldCheck className="w-8 h-8 text-indigo-600" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800">Welcome to Compliance Copilot</h3>
                    <p className="text-slate-500 mt-2 max-w-sm mx-auto">
                      Upload your internal policies and ask me anything about HR rules, legal guidelines, or finance procedures.
                    </p>
                  </div>
                )}

                {messages.map((msg) => (
                  <div 
                    key={msg.id}
                    className={cn(
                      "flex gap-4",
                      msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                      msg.role === 'user' ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                    )}>
                      {msg.role === 'user' ? 'U' : <ShieldCheck className="w-5 h-5" />}
                    </div>
                    <div className={cn(
                      "max-w-[85%] rounded-2xl p-4",
                      msg.role === 'user' ? "bg-indigo-600 text-white" : "bg-slate-50 border border-slate-100"
                    )}>
                      <div className="prose prose-slate prose-sm max-w-none prose-p:leading-relaxed">
                        <Markdown>{msg.content}</Markdown>
                      </div>
                      
                      {msg.data && (
                        <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
                          {msg.data.isFailure ? (
                            <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-start gap-3">
                              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm font-bold text-red-800">System Uncertainty Detected</p>
                                <p className="text-xs text-red-600 mt-1">{msg.data.failureReason || "I'm not confident in this answer based on the available policies."}</p>
                                <p className="text-xs font-bold text-red-700 mt-2 uppercase tracking-wider">👉 {msg.data.suggestedAction}</p>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <Scale className="w-5 h-5 text-indigo-600" />
                                  <div>
                                    <p className="text-[10px] uppercase font-bold text-slate-400">Compliance Decision</p>
                                    <p className={cn(
                                      "text-sm font-black",
                                      msg.data.decision === 'Allowed' ? "text-green-600" : 
                                      msg.data.decision === 'Not Allowed' ? "text-red-600" : "text-amber-600"
                                    )}>
                                      {msg.data.decision}
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] uppercase font-bold text-slate-400">Confidence</p>
                                  <p className="text-sm font-black text-indigo-600">{msg.data.confidenceScore}%</p>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Risk Level</p>
                                  <div className="flex items-center gap-2">
                                    {msg.data.riskLevel === 'Low' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                    {msg.data.riskLevel === 'Medium' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                                    {msg.data.riskLevel === 'High' && <XCircle className="w-4 h-4 text-red-500" />}
                                    <span className={cn(
                                      "text-xs font-bold",
                                      msg.data.riskLevel === 'Low' ? "text-green-600" : 
                                      msg.data.riskLevel === 'Medium' ? "text-amber-600" : "text-red-600"
                                    )}>
                                      {msg.data.riskLevel}
                                    </span>
                                  </div>
                                </div>
                                <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                                  <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Performance</p>
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-500">{msg.metrics?.latency}ms</span>
                                    <span className="text-[10px] text-slate-500">${msg.metrics?.cost.toFixed(4)}</span>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}

                          {msg.data.keyExcerpts && !msg.data.isFailure && (
                            <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100">
                              <p className="text-[10px] uppercase font-bold text-indigo-400 mb-2">Key Source Text</p>
                              <ul className="space-y-2">
                                {msg.data.keyExcerpts.map((ex: string, i: number) => (
                                  <li key={i} className="text-xs text-indigo-900 italic leading-relaxed">
                                    "{ex}"
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </motion.div>
            )}

            {activeTab === 'checker' && (
              <motion.div 
                key="checker"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-3xl mx-auto space-y-8"
              >
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
                  <div className="bg-indigo-600 p-8 text-white">
                    <h3 className="text-2xl font-bold">Compliance Risk Checker</h3>
                    <p className="text-indigo-100 mt-2">Describe a proposed action or scenario to evaluate its compliance risk based on internal policies.</p>
                  </div>
                  <div className="p-8">
                    <textarea 
                      className="w-full h-40 p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-slate-700"
                      placeholder="e.g., 'I want to accept a gift from a potential vendor worth $200. Is this allowed?'"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                    />
                    <div className="flex gap-4 mt-6">
                      <button 
                        onClick={handleQuery}
                        disabled={isProcessing || !input.trim()}
                        className="flex-1 bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                        Assess Compliance Risk
                      </button>
                      {checkerResult && (
                        <button 
                          onClick={() => { setCheckerResult(null); setInput(''); }}
                          className="px-6 bg-slate-100 text-slate-600 py-4 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {checkerResult && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden"
                  >
                    <div className={cn(
                      "p-6 flex items-center justify-between",
                      checkerResult.riskLevel === 'Low' ? "bg-green-50" : 
                      checkerResult.riskLevel === 'Medium' ? "bg-amber-50" : "bg-red-50"
                    )}>
                      <div className="flex items-center gap-3">
                        {checkerResult.riskLevel === 'Low' && <CheckCircle2 className="w-8 h-8 text-green-500" />}
                        {checkerResult.riskLevel === 'Medium' && <AlertTriangle className="w-8 h-8 text-amber-500" />}
                        {checkerResult.riskLevel === 'High' && <XCircle className="w-8 h-8 text-red-500" />}
                        <div>
                          <h4 className="font-bold text-slate-800">Risk Level: {checkerResult.riskLevel}</h4>
                          <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Assessment Complete</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-bold text-slate-400 uppercase">Confidence</p>
                        <p className="text-xl font-black text-indigo-600">{checkerResult.confidenceScore}%</p>
                      </div>
                    </div>
                    
                    <div className="p-8 space-y-6">
                      <div>
                        <h5 className="text-sm font-bold text-slate-400 uppercase mb-3">Analysis & Recommendation</h5>
                        <div className="prose prose-slate prose-sm max-w-none">
                          <Markdown>{checkerResult.answer}</Markdown>
                        </div>
                      </div>

                      {checkerResult.keyExcerpts && (
                        <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                          <h5 className="text-sm font-bold text-slate-400 uppercase mb-4">Supporting Policy Excerpts</h5>
                          <div className="space-y-4">
                            {checkerResult.keyExcerpts.map((ex: string, i: number) => (
                              <div key={i} className="flex gap-3">
                                <div className="w-1 h-auto bg-indigo-200 rounded-full flex-shrink-0" />
                                <p className="text-sm text-slate-600 italic leading-relaxed">
                                  "{ex}"
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {activeTab === 'audit' && (
              <motion.div 
                key="audit"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-5xl mx-auto"
              >
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="p-4 text-xs font-bold text-slate-400 uppercase">Timestamp</th>
                        <th className="p-4 text-xs font-bold text-slate-400 uppercase">Query</th>
                        <th className="p-4 text-xs font-bold text-slate-400 uppercase">Decision</th>
                        <th className="p-4 text-xs font-bold text-slate-400 uppercase">Risk</th>
                        <th className="p-4 text-xs font-bold text-slate-400 uppercase">Role</th>
                        <th className="p-4 text-xs font-bold text-slate-400 uppercase">Metrics</th>
                        <th className="p-4 text-xs font-bold text-slate-400 uppercase">Feedback</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                          <td className="p-4 text-xs text-slate-500">
                            {log.timestamp.toLocaleTimeString()}
                          </td>
                          <td className="p-4 text-sm font-medium text-slate-700 max-w-xs truncate">
                            {log.query}
                          </td>
                          <td className="p-4">
                            <span className={cn(
                              "text-xs font-bold",
                              log.decision === 'Allowed' ? "text-green-600" : 
                              log.decision === 'Not Allowed' ? "text-red-600" : "text-amber-600"
                            )}>
                              {log.decision}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className={cn(
                              "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                              log.riskLevel === 'Low' ? "bg-green-100 text-green-700" : 
                              log.riskLevel === 'Medium' ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                            )}>
                              {log.riskLevel}
                            </span>
                          </td>
                          <td className="p-4 text-xs font-medium text-slate-500 capitalize">
                            {log.role}
                          </td>
                          <td className="p-4 text-[10px] text-slate-400 font-mono">
                            {log.metrics.latency}ms / ${log.metrics.cost.toFixed(4)}
                          </td>
                          <td className="p-4">
                            {log.feedback ? (
                              <span className={cn(
                                "flex items-center gap-1 text-xs font-medium",
                                log.feedback === 'correct' ? "text-green-600" : "text-red-600"
                              )}>
                                {log.feedback === 'correct' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                {log.feedback}
                              </span>
                            ) : (
                              <div className="flex gap-2">
                                <button onClick={() => handleFeedback(log.id, 'correct')} className="p-1 hover:bg-green-50 rounded text-slate-400 hover:text-green-600">
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleFeedback(log.id, 'incorrect')} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600">
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="p-4">
                            <button className="text-indigo-600 hover:text-indigo-800 text-xs font-bold flex items-center gap-1">
                              View Details <ChevronRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {auditLogs.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-12 text-center text-slate-400 italic">
                            No audit logs available yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Input Area */}
        {activeTab === 'chat' && (
          <div className="p-8 bg-white border-t border-slate-100">
            <form onSubmit={handleQuery} className="max-w-3xl mx-auto relative">
              <input 
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={chunks.length > 0 ? "Ask a compliance question..." : "Upload a policy to start..."}
                disabled={isProcessing || chunks.length === 0}
                className="w-full pl-6 pr-16 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none text-slate-700 shadow-sm"
              />
              <button 
                type="submit"
                disabled={isProcessing || !input.trim() || chunks.length === 0}
                className="absolute right-2 top-2 bottom-2 px-4 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:bg-slate-300"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </form>
            <p className="text-[10px] text-center text-slate-400 mt-3 uppercase tracking-widest font-bold">
              AI-generated answers should be verified by legal teams.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
