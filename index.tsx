
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// --- Types ---

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'packet';
}

interface HistoryEntry {
  time: string;
  views: number;
}

interface ValidationResult {
  isValid: boolean;
  invalidLines: string[];
  totalLines: number;
}

type SyncState = 'idle' | 'syncing' | 'retrying' | 'success' | 'error' | 'cancelled';

// --- Utils ---

const PROXY_REGEX = /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?):([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/;

const validateProxies = (text: string): ValidationResult => {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { isValid: true, invalidLines: [], totalLines: 0 };
  
  const invalidLines = lines.filter(line => !PROXY_REGEX.test(line));
  return {
    isValid: invalidLines.length === 0,
    invalidLines,
    totalLines: lines.length
  };
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Sub-components ---

const ValidationIndicator: React.FC<{ isValid: boolean, hasContent: boolean }> = ({ isValid, hasContent }) => {
  if (!hasContent) return null;
  return (
    <div className={`flex items-center gap-1.5 ml-3 transition-all duration-300 transform scale-90 origin-left`}>
      {isValid ? (
        <>
          <span className="text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.6)] font-black text-[9px] tracking-tighter animate-pulse">VALID</span>
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></div>
        </>
      ) : (
        <>
          <span className="text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)] font-black text-[9px] tracking-tighter">INVALID</span>
          <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping shadow-[0_0_8px_#f43f5e]"></div>
        </>
      )}
    </div>
  );
};

const BetaTrafficHUD: React.FC = () => {
  const [nodes, setNodes] = useState<{id: number, active: boolean}[]>(
    Array.from({length: 12}, (_, i) => ({id: i, active: false}))
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setNodes(prev => prev.map(n => ({...n, active: Math.random() > 0.7})));
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full h-full bg-[#0c0c0f] border border-zinc-800 rounded-lg p-3 flex flex-col gap-2 overflow-hidden relative">
      <div className="absolute top-1 right-2 text-[7px] text-zinc-700 font-black">X-PKT/SEC: 142.2</div>
      <div className="flex-1 grid grid-cols-6 gap-1.5">
        {nodes.map(node => (
          <div key={node.id} className="flex flex-col items-center gap-1">
            <div className={`w-full h-1 rounded-full transition-all duration-150 ${node.active ? 'bg-[#e91e63] shadow-[0_0_10px_#e91e63]' : 'bg-zinc-800'}`}></div>
            <div className="text-[6px] text-zinc-700 font-bold">NODE_{node.id}</div>
          </div>
        ))}
      </div>
      <div className="h-6 flex items-center justify-between border-t border-zinc-800/50 mt-1 pt-1">
        <div className="flex gap-1">
           {[...Array(4)].map((_, i) => (
             <div key={i} className="w-1 h-3 bg-cyan-400/20 rounded-full overflow-hidden">
                <div className="w-full h-full bg-cyan-400 animate-bounce" style={{animationDelay: `${i * 0.1}s`}}></div>
             </div>
           ))}
        </div>
        <span className="text-[7px] text-[#e91e63] font-black uppercase tracking-widest animate-pulse">Syncing...</span>
      </div>
    </div>
  );
};

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

          <path
            d={`M${padding},${height-padding} L${points} L${width-padding},${height-padding} Z`}
            fill="url(#lineGradient)"
          />

          <polyline
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={points}
            className="drop-shadow-[0_0_5px_#22d3ee]"
          />
          
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
  const [proxiesLeft, setProxiesLeft] = useState<string>(() => localStorage.getItem('proxies_left') ?? "");
  const [proxiesRight, setProxiesRight] = useState<string>(() => localStorage.getItem('proxies_right') ?? "");
  const [urlA, setUrlA] = useState(() => localStorage.getItem('sync_url_a') ?? "");
  const [urlB, setUrlB] = useState(() => localStorage.getItem('sync_url_b') ?? "");
  
  const [searchTerm, setSearchTerm] = useState("");
  const [isBetaLive, setIsBetaLive] = useState(false);
  const [enableHttp, setEnableHttp] = useState(true);
  const [enableDualProxy, setEnableDualProxy] = useState(true);
  const [country, setCountry] = useState("United Kingdom");
  const [timeout, setTimeoutVal] = useState(0.87);
  const [proxyOffset, setProxyOffset] = useState(5000);

  const [videoUrl, setVideoUrl] = useState("tiktok.com/@socialbots");
  const [videoViews, setVideoViews] = useState(100000);
  const [incrementPercentage, setIncrementPercentage] = useState(33);
  const [incrementTime, setIncrementTime] = useState(30);

  const [status, setStatus] = useState<'Disconnected' | 'Connecting' | 'Connected' | 'Running'>('Connected');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [statusA, setStatusA] = useState<SyncState>('idle');
  const [statusB, setStatusB] = useState<SyncState>('idle');
  const [retriesA, setRetriesA] = useState(0);
  const [retriesB, setRetriesB] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isSyncing = statusA === 'syncing' || statusB === 'syncing' || statusA === 'retrying' || statusB === 'retrying';

  // Real-time Validation Memos
  const validationLeft = useMemo(() => validateProxies(proxiesLeft), [proxiesLeft]);
  const validationRight = useMemo(() => validateProxies(proxiesRight), [proxiesRight]);

  const [viewHistory, setViewHistory] = useState<HistoryEntry[]>([]);
  const [simulatedViews, setSimulatedViews] = useState(videoViews);
  const [threads, setThreads] = useState(0);
  const [successRate, setSuccessRate] = useState(100);

  const logEndRef = useRef<HTMLDivElement>(null);
  const fileInputLeftRef = useRef<HTMLInputElement>(null);
  const fileInputRightRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('proxies_left', proxiesLeft);
    localStorage.setItem('proxies_right', proxiesRight);
    localStorage.setItem('sync_url_a', urlA);
    localStorage.setItem('sync_url_b', urlB);
  }, [proxiesLeft, proxiesRight, urlA, urlB]);

  // Beta Live Packet Stream simulation
  useEffect(() => {
    if (isBetaLive && status === 'Running') {
      const pktInterval = setInterval(() => {
        const packets = [
          "PKT_PUSH :: 0x821... :: ACK",
          "HDR_SYNC :: OK :: TLS_1.3",
          "PROXY_HOP :: 192.168.1.1 -> 42.1.2.9",
          "UDP_FRAG :: REASSEMBLE :: [32/64]"
        ];
        addLog(packets[Math.floor(Math.random() * packets.length)], 'packet');
      }, 800);
      return () => clearInterval(pktInterval);
    }
  }, [isBetaLive, status]);

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
      addLog("Sync error: No cluster endpoints defined in configuration.", "error");
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
        // Fix: Explicitly setting error name to AbortError for correct catch block identification
        if (signal.aborted) {
          const abortErr = new Error('AbortError');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        try {
          setStatus(attempt === 0 ? 'syncing' : 'retrying');
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
          const response = await fetch(proxyUrl, { signal });
          if (!response.ok) throw new Error(`HTTP_${response.status} :: ${response.statusText}`);
          const content = await response.text();
          setStatus('success');
          return content;
        } catch (err: any) {
          // Fix: Checking for AbortError properly
          if (err.name === 'AbortError' || err.message === 'AbortError') throw err;
          
          let errorMsg = `Cluster ${side} attempt ${attempt + 1}/${maxRetries + 1} failed: `;
          if (err.message.includes("HTTP_")) {
             errorMsg += `Server returned ${err.message}`;
          } else if (err.name === 'TypeError') {
             errorMsg += "Network error or CORS policy restriction detected.";
          } else {
             errorMsg += err.message || "Unknown connectivity issue.";
          }

          addLog(errorMsg, "warning");

          if (attempt === maxRetries) {
            setStatus('error');
            addLog(`Cluster ${side} terminal failure: Unable to establish link after ${maxRetries + 1} attempts.`, "error");
            return null;
          }
          await wait(1500 * Math.pow(2, attempt)); // Exponential backoff
        }
      }
      return null;
    };
    try {
      // Fix: Use Promise.all instead of allSettled so AbortError can be caught by the outer block
      const results = await Promise.all([fetchWithRetry(urlA, 'A'), fetchWithRetry(urlB, 'B')]);
      results.forEach((content, i) => {
        const side = i === 0 ? 'A' : 'B';
        if (content) {
          const allLines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          const validProxies = allLines.filter(l => PROXY_REGEX.test(l));
          
          if (i === 0) setProxiesLeft(validProxies.join('\n')); else setProxiesRight(validProxies.join('\n'));
          
          if (validProxies.length === 0 && allLines.length > 0) {
            addLog(`Cluster ${side} fetch successful, but 0 valid proxy patterns found in ${allLines.length} lines.`, "warning");
          } else {
            addLog(`Cluster ${side} synchronization complete. Loaded ${validProxies.length}/${allLines.length} valid nodes.`, "success");
          }
        }
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'AbortError') {
        addLog("Synchronization sequence manually terminated by operator.", "warning");
        // Fix: Use functional state updates to avoid TypeScript narrowing errors in the closure
        setStatusA(prev => (prev === 'syncing' || prev === 'retrying') ? 'idle' : prev);
        setStatusB(prev => (prev === 'syncing' || prev === 'retrying') ? 'idle' : prev);
      } else {
        addLog(`Sync operation aborted unexpectedly: ${err.message}`, "error");
      }
    } finally { 
      abortControllerRef.current = null; 
    }
  };

  const handleCancelSync = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleScrapeProxies = async () => {
    if (isScraping) return;
    setIsScraping(true);
    addLog("Handshaking with global scraping engine...", "info");
    try {
      // Fix: Create a new GoogleGenAI instance right before making an API call
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Scrape 80 high-quality public proxy nodes (IP:PORT). Realistic data. Format: one per line. No headers.`
      });
      const proxies = (response.text || "").split('\n').map(l => l.trim()).filter(l => PROXY_REGEX.test(l));
      if (proxies.length > 0) {
        setProxiesLeft(proxies.slice(0, 40).join('\n'));
        setProxiesRight(proxies.slice(40).join('\n'));
        addLog(`Successfully harvested ${proxies.length} nodes into local cache.`, "success");
      } else {
        addLog("Scraper returned empty result set. Node availability low.", "warning");
      }
    } catch (err: any) {
      addLog(`Scraping engine offline: ${err.message || 'API key error'}.`, "error");
    } finally { setIsScraping(false); }
  };

  const handleStartBot = async () => {
    if (isProcessing) return;
    
    let errorLog = "";
    if (!validationLeft.isValid) errorLog += `Master A has ${validationLeft.invalidLines.length} malformed entries. `;
    if (!validationRight.isValid) errorLog += `Master B has ${validationRight.invalidLines.length} malformed entries. `;
    if (validationLeft.totalLines === 0 && validationRight.totalLines === 0) errorLog += "Both proxy lists are empty.";

    if (errorLog) {
      addLog(`Pre-flight validation failed: ${errorLog.trim()}`, "error");
      return;
    }

    setIsProcessing(true);
    setStatus('Running');
    setSimulatedViews(videoViews);
    setViewHistory([{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), views: videoViews }]);
    addLog(`Initiating injection sequence for ${videoUrl}...`, 'info');
    try {
      // Fix: Create a new GoogleGenAI instance right before making an API call
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Technical logs for TikTok view injection. URL: ${videoUrl}, Views: ${videoViews}. 8 lines. Professional syntax.`
      });
      for (const log of (response.text?.split('\n') || [])) {
        await wait(600 + Math.random() * 800);
        addLog(log, log.toLowerCase().includes('err') ? 'error' : 'info');
      }
      addLog("Process steady state reached. Background worker active.", "success");
    } catch (err: any) { addLog(`Communication failure with worker nodes: ${err.message}`, "error"); } finally { setIsProcessing(false); }
  };

  const handleStopBot = () => { setStatus('Connected'); addLog("Emergency shutdown initiated. Workers detached.", "warning"); };

  const getSyncStatusIndicator = (status: SyncState, retries: number) => {
    if (status === 'syncing') return <span className="text-blue-400 animate-pulse text-[8px] font-black">SYNCING...</span>;
    if (status === 'retrying') return <span className="text-amber-500 animate-pulse text-[8px] font-black">RETRY {retries}...</span>;
    if (status === 'success') return <span className="text-emerald-500 text-[8px] font-black">ACTIVE</span>;
    if (status === 'error') return <span className="text-rose-500 text-[8px] font-black">FAILURE</span>;
    return null;
  };

  return (
    <div className={`min-h-screen bg-[#0a0a0d] text-zinc-300 font-sans p-4 md:p-6 flex items-center justify-center selection:bg-[#e91e63] selection:text-white transition-all duration-700 ${isBetaLive ? 'crt-effect' : ''}`}>
      <div className={`max-w-6xl w-full border border-zinc-800 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.8)] bg-[#111115] overflow-hidden flex flex-col transition-all duration-500 ${isBetaLive ? 'border-[#e91e63] shadow-[0_0_30px_rgba(233,30,99,0.2)]' : 'border-t-[#e91e63]'}`}>
        <div className="bg-[#0c0c0f] p-4 border-b border-zinc-800 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded shadow-[0_0_12px_#e91e63] transition-colors ${isBetaLive ? 'bg-cyan-400 shadow-[0_0_12px_#22d3ee]' : 'bg-[#e91e63]'}`}></div>
            <div>
              <h1 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-100 flex items-center gap-2">
                SocialBots Automator
                {isBetaLive && <span className="px-1.5 py-0.5 bg-[#e91e63] text-white text-[7px] rounded animate-pulse">BETA LIVE</span>}
              </h1>
              <div className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest mt-0.5">Cluster v4.2.0 Stable Build</div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setIsBetaLive(!isBetaLive)} 
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[8px] font-black transition-all ${isBetaLive ? 'bg-cyan-400/10 border-cyan-400/40 text-cyan-400' : 'bg-zinc-900 border-zinc-800 text-zinc-600 hover:text-zinc-300'}`}
            >
              <div className={`w-1 h-1 rounded-full ${isBetaLive ? 'bg-cyan-400 animate-ping' : 'bg-zinc-700'}`}></div>
              {isBetaLive ? 'EXIT BETA LIVE' : 'ENTER BETA TEST'}
            </button>
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-black text-zinc-600 uppercase tracking-tighter">System Integrity</span>
              <span className="text-[10px] font-bold text-emerald-500">OPTIMAL</span>
            </div>
            <button onClick={resetAll} className="p-2 hover:bg-zinc-800 rounded transition-colors text-zinc-600 hover:text-rose-500" title="Factory Reset">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 relative">
          {isBetaLive && <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.5)_50%)] bg-[length:100%_4px] z-50"></div>}

          <section className="lg:col-span-7 space-y-6">
            <div className="relative border border-zinc-800 rounded-xl p-5 bg-[#16161c]">
              <span className="absolute -top-3 left-4 bg-[#16161c] px-2 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Proxy Environment</span>
              <div className="mb-4 relative group">
                <input type="text" placeholder="SEARCH GLOBAL CLUSTER..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-[#0c0c0f] border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-[10px] uppercase font-black tracking-widest text-zinc-100 focus:outline-none focus:border-[#e91e63]/40 transition-all placeholder-zinc-800" />
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
                    <button 
                      onClick={handleCancelSync} 
                      className="px-4 py-2.5 bg-rose-500/10 border border-rose-500/40 text-rose-500 text-[10px] font-black rounded-lg hover:bg-rose-500 hover:text-white transition-all uppercase tracking-widest animate-in fade-in zoom-in"
                    >
                      Cancel Sync
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="lg:col-span-5 space-y-6 flex flex-col">
            <div className="relative border border-zinc-800 rounded-xl p-5 bg-[#16161c] flex flex-col flex-1 h-full">
              <span className="absolute -top-3 left-4 bg-[#16161c] px-2 text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                {isBetaLive ? 'Beta Traffic Stream' : 'Target Analytics'}
                {isBetaLive && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>}
              </span>
              
              {isBetaLive ? (
                <div className="flex-1 mb-6 mt-2">
                   <BetaTrafficHUD />
                </div>
              ) : (
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
              )}

              <div className="flex-1 flex flex-col min-h-[160px] relative mb-4">
                <div className="flex justify-between items-center mb-1 px-1">
                  <span className="text-[8px] font-black text-zinc-700 uppercase tracking-widest">Injection Monitor / Delta T</span>
                  {viewHistory.length > 0 && (
                    <button onClick={() => setViewHistory([])} className="text-[8px] text-[#e91e63] font-black uppercase hover:underline">RESET DATA</button>
                  )}
                </div>
                <ViewHistoryChart data={viewHistory} />
              </div>

              <div className="grid grid-cols-2 gap-3 mt-auto">
                {status === 'Running' ? (
                  <button onClick={handleStopBot} className="py-3 bg-transparent border border-rose-500 text-rose-500 text-xs font-black rounded-xl hover:bg-rose-500 hover:text-white transition-all uppercase tracking-[0.2em] shadow-[0_0_15px_rgba(244,63,94,0.1)]">ABORT INJECTION</button>
                ) : (
                  <button onClick={handleStartBot} disabled={isProcessing} className={`py-3 bg-transparent border text-xs font-black rounded-xl transition-all uppercase tracking-[0.2em] shadow-[0_0_15px_rgba(233,30,99,0.1)] disabled:opacity-50 ${isBetaLive ? 'border-cyan-400 text-cyan-400 hover:bg-cyan-400 hover:text-black' : 'border-[#e91e63] text-[#e91e63] hover:bg-[#e91e63] hover:text-white'}`}>
                    {isProcessing ? 'CALIBRATING...' : 'INITIATE BATCH'}
                  </button>
                )}
                <button className={`py-3 bg-zinc-800 text-zinc-100 text-xs font-black rounded-xl hover:bg-zinc-700 transition-all uppercase tracking-[0.2em] ${isBetaLive ? 'border-cyan-400/20' : ''}`}>CALIBRATE NODES</button>
              </div>
            </div>
          </section>
        </div>

        <div className="px-6 pb-6">
          <div className={`relative border rounded-xl p-4 bg-[#0c0c0f] shadow-inner transition-colors duration-500 ${isBetaLive ? 'border-cyan-400/30' : 'border-zinc-800'}`}>
             <div className="absolute -top-3 left-4 right-4 flex justify-between items-center z-10">
                <span className="bg-[#0c0c0f] px-2 text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em] flex items-center gap-2">
                  {isBetaLive ? 'Packet Sniffer v1.0' : 'Console Output / System Debug'}
                  {isBetaLive && <span className="w-1 h-1 bg-cyan-400 rounded-full animate-ping"></span>}
                </span>
                <div className="flex gap-4 bg-[#0c0c0f] px-2">
                  <button onClick={exportLogs} className="text-[9px] font-black text-zinc-500 hover:text-cyan-400 transition-colors uppercase tracking-tighter">[ Export Session ]</button>
                  <button onClick={clearLogs} className="text-[9px] font-black text-[#e91e63] hover:text-white transition-colors uppercase tracking-tighter">[ Clear Buffer ]</button>
                </div>
             </div>
             <div className="h-40 overflow-y-auto font-mono text-[10px] space-y-1 custom-scrollbar pr-2">
                {logs.length === 0 && <div className="text-zinc-800 italic uppercase font-bold text-center mt-12 opacity-50 tracking-[0.5em]">System Idle :: Awaiting Command</div>}
                {logs.map((log, idx) => (
                  <div key={idx} className="flex gap-3 leading-relaxed hover:bg-white/5 transition-colors px-1 rounded">
                    <span className={`text-zinc-700 select-none ${isBetaLive ? 'text-cyan-900' : ''}`}>[{log.timestamp}]</span>
                    <span className={`
                      ${log.type === 'success' ? 'text-emerald-400 font-bold' : ''} 
                      ${log.type === 'error' ? 'text-rose-400 font-bold' : ''} 
                      ${log.type === 'warning' ? 'text-amber-400' : ''} 
                      ${log.type === 'info' ? 'text-zinc-400' : ''}
                      ${log.type === 'packet' ? 'text-cyan-500 italic opacity-80' : ''}
                      ${isBetaLive && log.type !== 'packet' ? 'text-cyan-200' : ''}
                    `}>
                      {log.message}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
             </div>
          </div>
        </div>

        <footer className={`bg-[#0c0c0f] border-t px-6 py-3 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-zinc-600 transition-colors duration-500 ${isBetaLive ? 'border-cyan-400/30' : 'border-zinc-800'}`}>
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <span>Status:</span>
              <span className={`transition-colors font-black ${status === 'Running' ? (isBetaLive ? 'text-cyan-400' : 'text-cyan-400') : (status === 'Connected' ? 'text-emerald-500' : 'text-zinc-700')}`}>{status}</span>
              <div className={`w-2 h-2 rounded-full ${status === 'Running' ? (isBetaLive ? 'bg-cyan-400 animate-pulse shadow-[0_0_10px_#22d3ee]' : 'bg-cyan-400 animate-pulse shadow-[0_0_10px_#22d3ee]') : (status === 'Connected' ? 'bg-emerald-500/30' : 'bg-zinc-800')}`}></div>
            </div>
            {status === 'Running' && (
              <div className="flex gap-6 border-l border-zinc-800 pl-8">
                <div className="flex items-center gap-2"><span className="text-zinc-700">Views:</span><span className={`font-mono tracking-tighter ${isBetaLive ? 'text-cyan-400' : 'text-zinc-100'}`}>{simulatedViews.toLocaleString()}</span></div>
                <div className="flex items-center gap-2"><span className="text-zinc-700">Threads:</span><span className="text-cyan-400 font-mono">{Math.floor(threads)}</span></div>
                <div className="flex items-center gap-2"><span className="text-zinc-700">Success:</span><span className="text-emerald-400 font-mono">{successRate.toFixed(1)}%</span></div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 text-zinc-800">
             {isBetaLive && <span className="text-cyan-900 font-black animate-pulse">BETA_ENVIRO :: ENABLED</span>}
             <span>CUST_ID: 99421-XB</span>
             <span>NODE: LONDON_04</span>
          </div>
        </footer>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1f1f23; border-radius: 10px; border: 1px solid #0a0a0d; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #e91e63; }
        .preserve-3d { transform-style: preserve-3d; }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes zoom-in { from { transform: scale(0.95); } to { transform: scale(1); } }
        .animate-in { animation: fade-in 0.3s ease-out, zoom-in 0.3s ease-out; }
        
        .crt-effect {
          position: relative;
        }
        .crt-effect::before {
          content: " ";
          display: block;
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          right: 0;
          background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
          z-index: 1000;
          background-size: 100% 2px, 3px 100%;
          pointer-events: none;
        }
        .crt-effect::after {
          content: " ";
          display: block;
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          right: 0;
          background: rgba(18, 16, 16, 0.1);
          opacity: 0;
          z-index: 1000;
          pointer-events: none;
          animation: crt-flicker 0.15s infinite;
        }
        @keyframes crt-flicker {
          0% { opacity: 0.1; }
          100% { opacity: 0.2; }
        }
      `}</style>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<TikTokViewBot />);
