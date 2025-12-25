
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// --- Types ---

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface HistoryEntry {
  time: string;
  views: number;
}

interface ValidationResult {
  isValid: boolean;
  invalidLines: string[];
}

type SyncState = 'idle' | 'syncing' | 'retrying' | 'success' | 'error' | 'cancelled';

// --- Utils ---

const PROXY_REGEX = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?):([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/;

const validateProxies = (text: string): ValidationResult => {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { isValid: true, invalidLines: [] };
  
  const invalidLines = lines.filter(line => !PROXY_REGEX.test(line));
  return {
    isValid: invalidLines.length === 0,
    invalidLines
  };
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Sub-components ---

const ViewHistoryChart: React.FC<{ data: HistoryEntry[] }> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  if (data.length < 2) {
    return (
      <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-700 font-bold uppercase tracking-widest bg-[#0c0c0f]/50 border border-zinc-800 rounded-lg italic transition-all duration-500">
        Awaiting Data Stream...
      </div>
    );
  }

  const padding = 20;
  const { width, height } = dimensions;
  
  const maxViews = Math.max(...data.map(d => d.views));
  const minViews = Math.min(...data.map(d => d.views));
  const range = maxViews - minViews || 1;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - ((d.views - minViews) / range) * (height - padding * 2) - padding;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div ref={containerRef} className="w-full h-full bg-[#0c0c0f] border border-zinc-800 rounded-lg p-2 relative group overflow-hidden shadow-inner">
      <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
        <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_8px_#22d3ee]"></div>
        <span className="text-[8px] text-cyan-400 font-black uppercase tracking-tighter">Live Monitor</span>
      </div>
      
      {width > 0 && height > 0 && (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full preserve-3d">
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
          </defs>
          
          {/* Grid lines */}
          {[0, 1, 2, 3].map(i => (
            <line 
              key={i} 
              x1={padding} 
              y1={padding + (i * (height - padding * 2)) / 3} 
              x2={width - padding} 
              y2={padding + (i * (height - padding * 2)) / 3} 
              stroke="#18181b" 
              strokeWidth="0.5" 
            />
          ))}

          {/* Area Fill */}
          <path
            d={`M${padding},${height-padding} L${points} L${width-padding},${height-padding} Z`}
            fill="url(#lineGradient)"
          />

          {/* The Line */}
          <polyline
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points}
            className="drop-shadow-[0_0_5px_#22d3ee]"
          />
          
          {/* Data points */}
          {data.map((d, i) => {
             const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
             const y = height - ((d.views - minViews) / range) * (height - padding * 2) - padding;
             return (
               <circle key={i} cx={x} cy={y} r="2" fill="#22d3ee" className="hover:r-3 cursor-crosshair transition-all" />
             );
          })}
        </svg>
      )}
      
      <div className="absolute bottom-1 left-2 right-2 flex justify-between text-[7px] font-black text-zinc-600 uppercase tracking-tighter">
        <span>{data[0].time}</span>
        <div className="flex gap-3">
          <span className="text-zinc-700">RANGE: {minViews.toLocaleString()} - {maxViews.toLocaleString()}</span>
          <span className="text-cyan-400/70">Δ {Math.round(data[data.length-1].views - data[0].views).toLocaleString()}</span>
        </div>
        <span>{data[data.length - 1].time}</span>
      </div>
    </div>
  );
};

interface HighlightedProxyAreaProps {
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  searchTerm?: string;
}

const HighlightedProxyArea: React.FC<HighlightedProxyAreaProps> = ({ value, onChange, placeholder, searchTerm }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const lines = value.split('\n');

  return (
    <div className="relative w-full h-32 font-mono text-[10px] bg-[#121216] border border-zinc-800 rounded overflow-hidden group focus-within:border-[#e91e63]/50 transition-all">
      <div 
        ref={backdropRef}
        className="absolute inset-0 p-2 pointer-events-none whitespace-pre-wrap break-all text-transparent select-none overflow-hidden"
        aria-hidden="true"
      >
        {lines.map((line, i) => {
          const trimmed = line.trim();
          const isInvalid = trimmed.length > 0 && !PROXY_REGEX.test(trimmed);
          const isMatch = searchTerm ? line.toLowerCase().includes(searchTerm.toLowerCase()) : true;
          
          return (
            <div 
              key={i} 
              className={`min-h-[1.25rem] w-full transition-all duration-150
                ${isInvalid ? 'bg-rose-500/20' : ''} 
                ${searchTerm && isMatch ? 'bg-cyan-500/15' : ''}
                ${searchTerm && !isMatch ? 'opacity-10 grayscale' : 'opacity-100'}
              `}
            >
              {line || ' '}
            </div>
          );
        })}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
        className="relative z-10 w-full h-full p-2 bg-transparent text-zinc-300 caret-[#e91e63] resize-none focus:outline-none placeholder-zinc-800 custom-scrollbar font-mono leading-relaxed"
      />
    </div>
  );
};

// --- Main App ---

const TikTokViewBot = () => {
  // Proxy States
  const [proxiesLeft, setProxiesLeft] = useState<string>(() => localStorage.getItem('proxies_left') ?? "");
  const [proxiesRight, setProxiesRight] = useState<string>(() => localStorage.getItem('proxies_right') ?? "");
  const [urlA, setUrlA] = useState(() => localStorage.getItem('sync_url_a') ?? "");
  const [urlB, setUrlB] = useState(() => localStorage.getItem('sync_url_b') ?? "");
  
  // Settings States
  const [searchTerm, setSearchTerm] = useState("");
  const [enableHttp, setEnableHttp] = useState(true);
  const [enableDualProxy, setEnableDualProxy] = useState(true);
  const [country, setCountry] = useState("United Kingdom");
  const [timeout, setTimeoutVal] = useState(0.87);
  const [proxyOffset, setProxyOffset] = useState(5000);

  // Video States
  const [videoUrl, setVideoUrl] = useState("tiktok.com/@socialbots");
  const [videoViews, setVideoViews] = useState(100000);
  const [incrementPercentage, setIncrementPercentage] = useState(33);
  const [incrementTime, setIncrementTime] = useState(30);

  // Bot Lifecycle States
  const [status, setStatus] = useState<'Disconnected' | 'Connecting' | 'Connected' | 'Running'>('Connected');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Sync Lifecycle States
  const [statusA, setStatusA] = useState<SyncState>('idle');
  const [statusB, setStatusB] = useState<SyncState>('idle');
  const [retriesA, setRetriesA] = useState(0);
  const [retriesB, setRetriesB] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isSyncing = statusA === 'syncing' || statusB === 'syncing' || statusA === 'retrying' || statusB === 'retrying';

  // Validation States
  const validationLeft = useMemo(() => validateProxies(proxiesLeft), [proxiesLeft]);
  const validationRight = useMemo(() => validateProxies(proxiesRight), [proxiesRight]);

  // Analytics States
  const [viewHistory, setViewHistory] = useState<HistoryEntry[]>([]);
  const [simulatedViews, setSimulatedViews] = useState(videoViews);
  const [threads, setThreads] = useState(0);
  const [successRate, setSuccessRate] = useState(100);

  const logEndRef = useRef<HTMLDivElement>(null);
  const fileInputLeftRef = useRef<HTMLInputElement>(null);
  const fileInputRightRef = useRef<HTMLInputElement>(null);
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Persistence
  useEffect(() => {
    localStorage.setItem('proxies_left', proxiesLeft);
    localStorage.setItem('proxies_right', proxiesRight);
    localStorage.setItem('sync_url_a', urlA);
    localStorage.setItem('sync_url_b', urlB);
  }, [proxiesLeft, proxiesRight, urlA, urlB]);

  // Real-time Simulation Engine
  useEffect(() => {
    let interval: number | undefined;
    if (status === 'Running') {
      setThreads(Math.floor(Math.random() * 50) + 120);
      interval = window.setInterval(() => {
        setSimulatedViews(prev => {
          const delta = Math.floor(videoViews * (incrementPercentage / 100) * (Math.random() * 0.4 + 0.8));
          const newVal = prev + delta;
          
          setViewHistory(history => {
            const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return [...history, { time: now, views: newVal }].slice(-25);
          });
          
          setSuccessRate(94 + Math.random() * 5.9);
          setThreads(prev => Math.max(80, prev + (Math.random() * 10 - 5)));
          return newVal;
        });
      }, incrementTime * 1000);
    } else {
      setThreads(0);
      setSuccessRate(100);
    }
    return () => clearInterval(interval);
  }, [status, videoViews, incrementPercentage, incrementTime]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    };
    setLogs(prev => [...prev.slice(-99), entry]);
  };

  const clearLogs = () => setLogs([]);

  const exportLogs = () => {
    const blob = new Blob([logs.map(l => `[${l.timestamp}] ${l.message}`).join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `socialbots-logs-${new Date().getTime()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("Session logs exported successfully.", "success");
  };

  const resetAll = () => {
    if (confirm("Reset all settings and proxy lists?")) {
      localStorage.clear();
      window.location.reload();
    }
  };

  const handleSyncFromUrls = async () => {
    if (isSyncing) return;
    if (!urlA && !urlB) {
      addLog("Sync error: No cluster endpoints defined.", "error");
      return;
    }
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    addLog("Initiating Multi-Cluster Synchronize sequence...", "info");

    const fetchWithRetry = async (url: string, side: 'A' | 'B', maxRetries = 3): Promise<string | null> => {
      if (!url) return null;
      const setStatus = side === 'A' ? setStatusA : setStatusB;
      const setRetries = side === 'A' ? setRetriesA : setRetriesB;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal.aborted) throw new Error('AbortError');
        try {
          setStatus(attempt === 0 ? 'syncing' : 'retrying');
          setRetries(attempt);
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
          const response = await fetch(proxyUrl, { signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const content = await response.text();
          setStatus('success');
          return content;
        } catch (err: any) {
          if (err.name === 'AbortError') throw err;
          if (attempt === maxRetries) {
            setStatus('error');
            addLog(`Cluster ${side} connection timeout after ${maxRetries} attempts.`, "error");
            return null;
          }
          await wait(1000 * Math.pow(2, attempt));
        }
      }
      return null;
    };

    try {
      const [cA, cB] = await Promise.allSettled([
        fetchWithRetry(urlA, 'A'),
        fetchWithRetry(urlB, 'B')
      ]);
      
      [cA, cB].forEach((res, i) => {
        if (res.status === 'fulfilled' && res.value) {
          const proxies = res.value.split('\n').map(l => l.trim()).filter(l => PROXY_REGEX.test(l));
          if (i === 0) setProxiesLeft(proxies.join('\n')); else setProxiesRight(proxies.join('\n'));
          addLog(`Cluster ${i === 0 ? 'A' : 'B'} synchronization complete (${proxies.length} nodes).`, "success");
        }
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') addLog(`Sync aborted: ${err.message}`, "error");
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleScrapeProxies = async () => {
    if (isScraping) return;
    setIsScraping(true);
    addLog("Handshaking with global scraping engine...", "info");
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Scrape 80 high-quality public proxy nodes (IP:PORT). Realistic data. Format: one per line. No headers.`
      });
      const proxies = (response.text || "").split('\n').map(l => l.trim()).filter(l => PROXY_REGEX.test(l));
      if (proxies.length > 0) {
        setProxiesLeft(proxies.slice(0, 40).join('\n'));
        setProxiesRight(proxies.slice(40).join('\n'));
        addLog(`Successfully harvested ${proxies.length} nodes into local cache.`, "success");
      }
    } catch (err) {
      addLog("Scraping engine offline. Please verify API key.", "error");
    } finally {
      setIsScraping(false);
    }
  };

  const handleStartBot = async () => {
    if (isProcessing) return;
    if (!validationLeft.isValid || !validationRight.isValid) {
      addLog("Validation error: Malformed proxy syntax detected.", "error");
      return;
    }

    setIsProcessing(true);
    setStatus('Running');
    setSimulatedViews(videoViews);
    setViewHistory([{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), views: videoViews }]);
    addLog(`Initiating injection sequence for ${videoUrl}...`, 'info');
    
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Technical logs for TikTok view injection. URL: ${videoUrl}, Views: ${videoViews}. 8 lines. Professional syntax.`
      });
      for (const log of (response.text?.split('\n') || [])) {
        await wait(600 + Math.random() * 800);
        addLog(log, log.toLowerCase().includes('err') ? 'error' : 'info');
      }
      addLog("Process steady state reached. Background worker active.", "success");
    } catch (err) {
      addLog("Communication failure with worker nodes.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStopBot = () => {
    setStatus('Connected');
    addLog("Emergency shutdown initiated. Workers detached.", "warning");
  };

  const getSyncStatusIndicator = (status: SyncState, retries: number) => {
    if (status === 'syncing') return <span className="text-blue-400 animate-pulse text-[8px] font-black">SYNCING...</span>;
    if (status === 'retrying') return <span className="text-amber-500 animate-pulse text-[8px] font-black">RETRY {retries}...</span>;
    if (status === 'success') return <span className="text-emerald-500 text-[8px] font-black">ACTIVE</span>;
    if (status === 'error') return <span className="text-rose-500 text-[8px] font-black">TIMEOUT</span>;
    return null;
  };

  const ValidationIndicator = ({ isValid, hasContent }: { isValid: boolean, hasContent: boolean }) => {
    if (!hasContent) return null;
    return isValid ? (
      <span className="text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)] font-black text-[10px] ml-2 animate-in fade-in zoom-in duration-300">✓</span>
    ) : (
      <span className="text-rose-500 drop-shadow-[0_0_5px_rgba(244,63,94,0.5)] font-black text-[10px] ml-2 animate-in fade-in zoom-in duration-300">✕</span>
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0a0d] text-zinc-300 font-sans p-4 md:p-6 flex items-center justify-center selection:bg-[#e91e63] selection:text-white">
      <input type="file" ref={fileInputLeftRef} className="hidden" />
      <input type="file" ref={fileInputRightRef} className="hidden" />

      <div className="max-w-6xl w-full border border-zinc-800 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.8)] bg-[#111115] overflow-hidden flex flex-col border-t-[#e91e63]">
        {/* Header */}
        <div className="bg-[#0c0c0f] p-4 border-b border-zinc-800 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 bg-[#e91e63] rounded shadow-[0_0_12px_#e91e63]"></div>
            <div>
              <h1 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-100">SocialBots Automator</h1>
              <div className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest mt-0.5">Cluster v4.2.0 Stable Build</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-black text-zinc-600 uppercase">System Integrity</span>
              <span className="text-[10px] font-bold text-emerald-500">OPTIMAL</span>
            </div>
            <button onClick={resetAll} className="p-2 hover:bg-zinc-800 rounded transition-colors text-zinc-600 hover:text-rose-500" title="Factory Reset">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Proxies & Config */}
          <section className="lg:col-span-7 space-y-6">
            <div className="relative border border-zinc-800 rounded-xl p-5 bg-[#16161c]">
              <span className="absolute -top-3 left-4 bg-[#16161c] px-2 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Proxy Environment</span>
              
              <div className="mb-4 relative group">
                <input 
                  type="text" 
                  placeholder="SEARCH GLOBAL CLUSTER..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-[#0c0c0f] border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-[10px] uppercase font-black tracking-widest text-zinc-100 focus:outline-none focus:border-[#e91e63]/40 transition-all placeholder-zinc-800"
                />
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-zinc-700">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <div className="flex items-center">
                      <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Master A</span>
                      <ValidationIndicator isValid={validationLeft.isValid} hasContent={proxiesLeft.trim().length > 0} />
                    </div>
                    <button className="text-[8px] text-[#e91e63] font-black hover:underline">IMPORT</button>
                  </div>
                  <HighlightedProxyArea value={proxiesLeft} onChange={setProxiesLeft} placeholder="MASTER_A NODES..." searchTerm={searchTerm} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <div className="flex items-center">
                      <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Master B</span>
                      <ValidationIndicator isValid={validationRight.isValid} hasContent={proxiesRight.trim().length > 0} />
                    </div>
                    <button className="text-[8px] text-[#e91e63] font-black hover:underline">IMPORT</button>
                  </div>
                  <HighlightedProxyArea value={proxiesRight} onChange={setProxiesRight} placeholder="MASTER_B NODES..." searchTerm={searchTerm} />
                </div>
              </div>

              <div className="mt-6 space-y-3 pt-4 border-t border-zinc-800/50">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between ml-1">
                      <label className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">ENDPOINT_A</label>
                      {getSyncStatusIndicator(statusA, retriesA)}
                    </div>
                    <input type="text" value={urlA} onChange={(e) => setUrlA(e.target.value)} placeholder="HTTPS://SOURCE.NODES/LIST_A" className="w-full bg-[#0c0c0f] border border-zinc-800 rounded px-3 py-2 text-[10px] text-zinc-400 focus:border-[#e91e63]/30 outline-none placeholder-zinc-900" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between ml-1">
                      <label className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">ENDPOINT_B</label>
                      {getSyncStatusIndicator(statusB, retriesB)}
                    </div>
                    <input type="text" value={urlB} onChange={(e) => setUrlB(e.target.value)} placeholder="HTTPS://SOURCE.NODES/LIST_B" className="w-full bg-[#0c0c0f] border border-zinc-800 rounded px-3 py-2 text-[10px] text-zinc-400 focus:border-[#e91e63]/30 outline-none placeholder-zinc-900" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSyncFromUrls} disabled={isSyncing} className="flex-1 py-2.5 bg-[#e91e63]/10 border border-[#e91e63]/20 text-[#e91e63] text-[10px] font-black rounded-lg hover:bg-[#e91e63] hover:text-white transition-all uppercase tracking-[0.2em] disabled:opacity-30">
                    {isSyncing ? 'SYNCING CLUSTERS...' : 'Synchronize Cluster'}
                  </button>
                  {isSyncing && (
                    <button onClick={() => abortControllerRef.current?.abort()} className="px-4 py-2.5 bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[10px] font-black rounded-lg hover:bg-rose-500 hover:text-white transition-all">
                      CANCEL
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 mt-6">
                <button onClick={handleScrapeProxies} disabled={isScraping} className="flex-1 py-2 bg-zinc-800 text-zinc-100 text-[10px] font-black rounded hover:bg-zinc-700 transition-all uppercase tracking-widest disabled:opacity-50">
                  {isScraping ? 'SCRAPING...' : 'GLOBAL HARVEST'}
                </button>
                <div className="flex-1">
                  <select value={country} onChange={(e) => setCountry(e.target.value)} className="w-full bg-[#0c0c0f] border border-zinc-800 rounded px-3 py-2 text-[10px] text-zinc-400 focus:border-[#e91e63]/30 outline-none font-black uppercase tracking-widest">
                    <option>United Kingdom</option>
                    <option>United States</option>
                    <option>Germany</option>
                    <option>Japan</option>
                    <option>Global Neutral</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Right Column: Video & Analytics */}
          <section className="lg:col-span-5 space-y-6 flex flex-col">
            <div className="relative border border-zinc-800 rounded-xl p-5 bg-[#16161c] flex flex-col flex-1 h-full">
              <span className="absolute -top-3 left-4 bg-[#16161c] px-2 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Target Analytics</span>
              
              <div className="space-y-4 mb-6">
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">Target Endpoint URL</label>
                  <input type="text" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} className="bg-[#0c0c0f] border border-zinc-800 rounded-lg px-3 py-2 text-[10px] font-mono text-cyan-400 focus:border-[#e91e63]/30 transition-all outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">Target Batch</label>
                    <input type="number" value={videoViews} onChange={(e) => setVideoViews(parseInt(e.target.value))} className="bg-[#0c0c0f] border border-zinc-800 rounded-lg px-3 py-2 text-[10px] font-mono text-zinc-100 focus:border-[#e91e63]/30 transition-all outline-none" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">Velocity (%)</label>
                    <input type="number" value={incrementPercentage} onChange={(e) => setIncrementPercentage(parseInt(e.target.value))} className="bg-[#0c0c0f] border border-zinc-800 rounded-lg px-3 py-2 text-[10px] font-mono text-zinc-100 focus:border-[#e91e63]/30 transition-all outline-none" />
                  </div>
                </div>
              </div>

              {/* Data Visualization Container */}
              <div className="flex-1 flex flex-col min-h-[160px] relative mb-4">
                <div className="flex justify-between items-center mb-1 px-1">
                  <span className="text-[8px] font-black text-zinc-700 uppercase tracking-widest">Injection Monitor / Delta T</span>
                  {viewHistory.length > 0 && (
                    <button onClick={() => setViewHistory([])} className="text-[8px] text-[#e91e63] font-black uppercase hover:underline">RESET DATA</button>
                  )}
                </div>
                <ViewHistoryChart data={viewHistory} />
              </div>

              {/* Bot Control */}
              <div className="grid grid-cols-2 gap-3 mt-auto">
                {status === 'Running' ? (
                  <button onClick={handleStopBot} className="py-3 bg-transparent border border-rose-500 text-rose-500 text-xs font-black rounded-xl hover:bg-rose-500 hover:text-white transition-all uppercase tracking-[0.2em] shadow-[0_0_15px_rgba(244,63,94,0.1)]">
                    ABORT INJECTION
                  </button>
                ) : (
                  <button onClick={handleStartBot} disabled={isProcessing} className="py-3 bg-transparent border border-[#e91e63] text-[#e91e63] text-xs font-black rounded-xl hover:bg-[#e91e63] hover:text-white transition-all uppercase tracking-[0.2em] shadow-[0_0_15px_rgba(233,30,99,0.1)] disabled:opacity-50">
                    {isProcessing ? 'CALIBRATING...' : 'INITIATE BATCH'}
                  </button>
                )}
                <button className="py-3 bg-zinc-800 text-zinc-100 text-xs font-black rounded-xl hover:bg-zinc-700 transition-all uppercase tracking-[0.2em]">
                  CALIBRATE NODES
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Bottom Panel: Logs */}
        <div className="px-6 pb-6">
          <div className="relative border border-zinc-800 rounded-xl p-4 bg-[#0c0c0f] shadow-inner">
             <div className="absolute -top-3 left-4 right-4 flex justify-between items-center z-10">
                <span className="bg-[#0c0c0f] px-2 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em]">Console Output / System Debug</span>
                <div className="flex gap-4 bg-[#0c0c0f] px-2">
                  <button onClick={exportLogs} className="text-[9px] font-black text-zinc-500 hover:text-cyan-400 transition-colors uppercase tracking-tighter">[ Export Session ]</button>
                  <button onClick={clearLogs} className="text-[9px] font-black text-[#e91e63] hover:text-white transition-colors uppercase tracking-tighter">[ Clear Buffer ]</button>
                </div>
             </div>
             <div className="h-40 overflow-y-auto font-mono text-[10px] space-y-1 custom-scrollbar pr-2">
                {logs.length === 0 && <div className="text-zinc-800 italic uppercase font-bold text-center mt-12 opacity-50 tracking-[0.5em]">System Idle :: Awaiting Command</div>}
                {logs.map((log, idx) => (
                  <div key={idx} className="flex gap-3 leading-relaxed hover:bg-white/5 transition-colors px-1 rounded">
                    <span className="text-zinc-700 select-none">[{log.timestamp}]</span>
                    <span className={`
                      ${log.type === 'success' ? 'text-emerald-400 font-bold' : ''}
                      ${log.type === 'error' ? 'text-rose-400 font-bold' : ''}
                      ${log.type === 'warning' ? 'text-amber-400' : ''}
                      ${log.type === 'info' ? 'text-zinc-400' : ''}
                    `}>
                      {log.message}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
             </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="bg-[#0c0c0f] border-t border-zinc-800 px-6 py-3 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-zinc-600">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <span>Status:</span>
              <span className={`transition-colors font-black ${status === 'Running' ? 'text-cyan-400' : (status === 'Connected' ? 'text-emerald-500' : 'text-zinc-700')}`}>{status}</span>
              <div className={`w-2 h-2 rounded-full ${status === 'Running' ? 'bg-cyan-400 animate-pulse shadow-[0_0_10px_#22d3ee]' : (status === 'Connected' ? 'bg-emerald-500/30' : 'bg-zinc-800')}`}></div>
            </div>
            {status === 'Running' && (
              <div className="flex gap-6 border-l border-zinc-800 pl-8">
                <div className="flex items-center gap-2"><span className="text-zinc-700">Views:</span><span className="text-zinc-100 font-mono tracking-tighter">{simulatedViews.toLocaleString()}</span></div>
                <div className="flex items-center gap-2"><span className="text-zinc-700">Threads:</span><span className="text-cyan-400 font-mono">{Math.floor(threads)}</span></div>
                <div className="flex items-center gap-2"><span className="text-zinc-700">Success:</span><span className="text-emerald-400 font-mono">{successRate.toFixed(1)}%</span></div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-zinc-800">CUST_ID: 99421-XB</span>
            <span className="text-zinc-800">NODE: LONDON_04</span>
          </div>
        </footer>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1f1f23; border-radius: 10px; border: 1px solid #0a0a0d; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #e91e63; }
        .preserve-3d { transform-style: preserve-3d; }
      `}</style>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<TikTokViewBot />);
