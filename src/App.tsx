import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { ArrowUp, RefreshCw, Check, PanelLeftClose, SquarePen, Trash2, MoreHorizontal, Edit2, Download, Plus, X, MessageSquare, BookOpen, Star } from 'lucide-react';
import { FakepediaView, ReviewsView, type ExternalSourcesData } from './ExternalSourcesViews';
import './index.css';

type ActiveTab = 'chat' | 'fakepedia' | 'reviews';

type NicheSummary = {
  id: string;
  name: string;
  description: string;
  pagesCount: number;
  chunksCount: number;
};

type SiteSummary = {
  url: string;
  crawledAt: string | null;
  chunksCount: number;
  pagesCount: number;
};

type IndexStatus = {
  localSite: SiteSummary | null;
  activeNiche: string;
  activeNicheInfo: NicheSummary | null;
  niches: NicheSummary[];
  customCompetitors: SiteSummary[];
};

type LoadingMessage = {
  type: 'text' | 'url';
  message?: string;
  url?: string;
};

type Message = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  thinking?: string;
  sources?: any[];
  rewrittenQuery?: string;
};

type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
};

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

function App() {
  const [chatList, setChatList] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string>(generateId());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlSuccess, setCrawlSuccess] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState<LoadingMessage>({ type: 'text', message: 'Processing...' });
  const [userLocation, setUserLocation] = useState<string>('');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [menuOpenForId, setMenuOpenForId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [isCrawlingCompetitor, setIsCrawlingCompetitor] = useState(false);
  const [isSwitchingNiche, setIsSwitchingNiche] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [healthWarnings, setHealthWarnings] = useState<string[]>([]);
  const [externalSources, setExternalSources] = useState<ExternalSourcesData>({
    fakepedia: { enabled: false, title: '', content: '', updatedAt: null, chunksCount: 0 },
    reviews: { enabled: false, brandName: '', items: [], updatedAt: null, chunksCount: 0 },
  });
  const [indexStatus, setIndexStatus] = useState<IndexStatus>({
    localSite: null,
    activeNiche: 'custom',
    activeNicheInfo: null,
    niches: [],
    customCompetitors: [],
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchExternalSources = async () => {
    try {
      const res = await fetch('/api/external-sources');
      if (res.ok) {
        const data: ExternalSourcesData = await res.json();
        setExternalSources(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealthWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      }
    } catch {
      setHealthWarnings(['Cannot reach FakeGPT backend on port 3002.']);
    }
  };

  const fetchIndexStatus = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/index-status');
      if (res.ok) {
        const data: IndexStatus = await res.json();
        setIndexStatus(data);
        if (data.localSite?.url) {
          setTargetUrl(prev => prev || data.localSite!.url);
        }
        return true;
      }
    } catch (e) {
      console.error(e);
    }
    return false;
  };

  const fetchChats = async () => {
    try {
      const res = await fetch('/api/chats');
      if (res.ok) {
        const data = await res.json();
        setChatList(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const initBackendState = async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        const ok = await fetchIndexStatus();
        if (ok) {
          if (!cancelled) {
            fetchChats();
            fetchExternalSources();
            fetchHealth();
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      if (!cancelled) {
        fetchHealth();
      }
    };
    initBackendState();
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}`);
            const data = await res.json();
            const city = data.address.city || data.address.town || data.address.village || data.address.state;
            const country = data.address.country;
            if (city && country) {
              setUserLocation(`${city}, ${country}`);
            } else {
              setUserLocation(`${position.coords.latitude}, ${position.coords.longitude}`);
            }
          } catch (e) {
            setUserLocation(`${position.coords.latitude}, ${position.coords.longitude}`);
          }
        },
        (error) => {
          console.error("Error getting location: ", error);
        }
      );
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const loadChat = async (id: string) => {
    try {
      const res = await fetch(`/api/chats/${id}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentChatId(data.id);
        setMessages(data.messages);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const lastGeneratedLengthRef = useRef<number>(0);

  useEffect(() => {
    lastGeneratedLengthRef.current = 0;
  }, [currentChatId]);

  const createNewChat = () => {
    setCurrentChatId(generateId());
    setMessages([]);
  };

  const generateTitle = async () => {
    if (messages.length === 0) return;
    if (messages.length === lastGeneratedLengthRef.current) return;
    
    lastGeneratedLengthRef.current = messages.length;
    try {
      await fetch(`/api/chats/${currentChatId}/title`, { method: 'POST' });
      fetchChats();
    } catch (e) {
      console.error("Failed to generate title", e);
      lastGeneratedLengthRef.current = 0;
    }
  };

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trigger 1: Idle Time
  useEffect(() => {
    if (messages.length > 0 && !isLoading) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        generateTitle();
      }, 30000); // 30 seconds of inactivity
    }
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [messages, isLoading, currentChatId]);

  // Trigger 2: Visibility / Pauses
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && messages.length > 0 && !isLoading) {
        generateTitle();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [messages, isLoading, currentChatId]);

  // Close menu on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      if (menuOpenForId) setMenuOpenForId(null);
    };
    if (menuOpenForId) {
      document.addEventListener('click', handleOutsideClick);
    }
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [menuOpenForId]);

  // Trigger 3 & 4: Turn 3 Rule and Length Milestones
  useEffect(() => {
    if (isLoading || messages.length === 0) return;
    
    // We only want to trigger this exactly when the condition is met, not repeatedly.
    // However, since it only runs when `isLoading` becomes false, it effectively runs once per assistant response.
    const userMessages = messages.filter(m => m.role === 'user');
    
    if (userMessages.length === 1 || userMessages.length === 3) {
       generateTitle();
    } else if (messages.length > 0 && messages.length % 10 === 0) {
       generateTitle();
    }
  }, [messages.length, isLoading, currentChatId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleCrawl = async () => {
    if (!targetUrl.trim()) return;
    setIsCrawling(true);
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl.trim() })
      });
      if (res.ok) {
        await res.json();
        setCrawlSuccess(true);
        fetchIndexStatus();
        setTimeout(() => setCrawlSuccess(false), 3000);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to crawl site: ${errData.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      alert(`Error crawling site: ${e.message}`);
    } finally {
      setIsCrawling(false);
    }
  };

  const handleRename = async (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      await fetch(`/api/chats/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() })
      });
      if (id === currentChatId) {
        lastGeneratedLengthRef.current = messages.length;
      }
      fetchChats();
    } catch (e) {
      console.error("Rename error", e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/chats/${id}`, { method: 'DELETE' });
      if (currentChatId === id) createNewChat();
      fetchChats();
    } catch (e) {
      console.error("Delete error", e);
    }
  };

  const handleClearHistory = async () => {
    try {
      const res = await fetch('/api/clear-history', { method: 'POST' });
      if (res.ok) {
        setChatList([]);
        createNewChat();
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error(`Failed to clear history: ${errData.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      console.error(`Error clearing history: ${e.message}`);
    }
  };

  const handleExportChats = async () => {
    try {
      const [chatsRes, extRes] = await Promise.all([
        fetch('/api/chats'),
        fetch('/api/external-sources'),
      ]);
      if (!chatsRes.ok) throw new Error('Failed to fetch chats');
      const chatsData = await chatsRes.json();
      const extData = extRes.ok ? await extRes.json() : null;
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        externalSources: extData,
        chats: chatsData,
      };
      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `fakegpt-chats-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`Failed to export chats: ${e.message}`);
    }
  };

  const handleClearLocalIndex = async () => {
    try {
      const res = await fetch('/api/clear-local-index', { method: 'POST' });
      if (res.ok) {
        setTargetUrl('');
        fetchIndexStatus();
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error(`Failed to clear local site: ${errData.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      console.error(`Error clearing local site: ${e.message}`);
    }
  };

  const handleSelectNiche = async (nicheId: string) => {
    setIsSwitchingNiche(true);
    try {
      const res = await fetch('/api/niches/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nicheId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to switch niche: ${errData.error || 'Unknown error'}`);
      }
      await fetchIndexStatus();
    } catch (e: any) {
      alert(`Error switching niche: ${e.message}`);
    } finally {
      setIsSwitchingNiche(false);
    }
  };

  const handleCrawlCompetitor = async () => {
    if (!competitorUrl.trim()) return;
    setIsCrawlingCompetitor(true);
    try {
      const res = await fetch('/api/competitors/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: competitorUrl.trim() }),
      });
      if (res.ok) {
        setCompetitorUrl('');
        await fetchIndexStatus();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to crawl competitor: ${errData.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      alert(`Error crawling competitor: ${e.message}`);
    } finally {
      setIsCrawlingCompetitor(false);
    }
  };

  const handleRemoveCompetitor = async (url?: string) => {
    try {
      const res = await fetch('/api/clear-competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(url ? { url } : {}),
      });
      if (res.ok) {
        fetchIndexStatus();
      }
    } catch (e: any) {
      console.error(`Error removing competitor: ${e.message}`);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);
    setInput('');
    setIsLoading(true);

    try {
      const chatHistory = currentMessages.filter(m => m.role !== 'system' && m.role !== 'tool');
      
      const response = await fetch(`/api/chats/${currentChatId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory,
          targetUrl: targetUrl.trim() || undefined,
          userLocation: userLocation || undefined
        }),
      });

      if (!response.ok) throw new Error('Network response was not ok');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      // done variable removed
      let buffer = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') {
              // done
            } else {
              try {
                const data = JSON.parse(dataStr);
                if (data.content) {
                  setIsLoading(false);
                  setMessages(prev => {
                    const newM = [...prev];
                    const last = { ...newM[newM.length - 1] };
                    last.content += data.content;
                    newM[newM.length - 1] = last;
                    return newM;
                  });
                }
                if (data.sources) {
                  setMessages(prev => {
                    const newM = [...prev];
                    const last = { ...newM[newM.length - 1] };
                    last.sources = data.sources;
                    if (data.rewrittenQuery) last.rewrittenQuery = data.rewrittenQuery;
                    newM[newM.length - 1] = last;
                    return newM;
                  });
                }
                if (data.thinking) {
                  setMessages(prev => {
                    const newM = [...prev];
                    const last = { ...newM[newM.length - 1] };
                    last.thinking = (last.thinking || '') + data.thinking.replace(/\n \+/g, '\n');
                    newM[newM.length - 1] = last;
                    return newM;
                  });
                }
              } catch (e) {
                // partial json or parse error, ignore
              }
            }
          } else if (line.startsWith('event: ')) {
            const eventStr = line.slice(7);
            const event = JSON.parse(eventStr);

            if (event.type === "message") {
              setLoadingMessage({ type: "text", message: event.content || 'Processing...' });
            } else if (event.type === "url") {
              setLoadingMessage({ type: "url", url: event.content });
            }
          }
        }
      }

      // Refresh chat list and index status (in case new web competitors were cached)
      fetchChats();
      fetchIndexStatus();
    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Oops! I encountered an unexpected error while trying to process your request. Please try asking your question again later.` 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      <div className="titlebar"></div>
      <div className={`sidebar ${!isSidebarOpen ? 'collapsed' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', padding: '0.5rem 0.75rem', height: '40px', marginTop: '30px' }}>
          {isSidebarOpen ? (
            <img src="/gpt-logo.svg?v=2" alt="Logo" style={{ width: '20px', height: '20px', filter: 'invert(1)' }} />
          ) : (
            <button onClick={() => setIsSidebarOpen(true)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }} className="no-drag" title="Open sidebar">
              <img src="/gpt-logo.svg?v=2" alt="Logo" style={{ width: '20px', height: '20px', filter: 'invert(1)' }} />
            </button>
          )}

          {isSidebarOpen && (
            <button onClick={() => setIsSidebarOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7, padding: '4px', borderRadius: '4px', marginRight: '-4px' }} className="hover-bg no-drag" title="Close sidebar">
              <PanelLeftClose size={20} />
            </button>
          )}
        </div>

        <button 
          className={`new-chat-btn ${messages.length === 0 ? 'active' : ''}`}
          onClick={createNewChat}
          title={!isSidebarOpen ? "New Chat" : ""}
        >
          <SquarePen size={16} style={{ flexShrink: 0 }} />
          {isSidebarOpen && <span>New chat</span>}
        </button>
        
        {isSidebarOpen && (
          <>
            <div className="chat-history-list">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', padding: '0.5rem 0.75rem', marginTop: '0.5rem' }}>
                <span>Recents</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button onClick={handleExportChats} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }} title="Export Chat History (JSON)">
                    <Download size={12} className="hover-text-primary" />
                  </button>
                  <button onClick={handleClearHistory} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }} title="Clear Chat History">
                    <Trash2 size={12} className="hover-text-primary" />
                  </button>
                </div>
              </div>
              {chatList.map(chat => (
                <div 
                  key={chat.id} 
                  className={`chat-history-item ${chat.id === currentChatId ? 'active' : ''}`}
                  onClick={() => loadChat(chat.id)}
                >
                  {editingChatId === chat.id ? (
                    <input 
                      type="text"
                      className="chat-title-input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => {
                        setEditingChatId(null);
                        handleRename(chat.id, editTitle);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                           setEditingChatId(null);
                           handleRename(chat.id, editTitle);
                        } else if (e.key === 'Escape') {
                           setEditingChatId(null);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <>
                      <span className="chat-title">{chat.title || 'New Chat'}</span>
                      <div className="chat-item-menu" onClick={(e) => e.stopPropagation()}>
                        <button className="menu-trigger" onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenuPos({ top: rect.bottom, left: rect.left });
                          setMenuOpenForId(menuOpenForId === chat.id ? null : chat.id);
                        }}>
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {menuOpenForId && (() => {
              const activeChat = chatList.find(c => c.id === menuOpenForId);
              if (!activeChat) return null;
              return (
                <div className="chat-dropdown" style={{ top: menuPos.top, left: menuPos.left }}>
                  <button onClick={() => {
                    setEditingChatId(activeChat.id);
                    setEditTitle(activeChat.title || 'New Chat');
                    setMenuOpenForId(null);
                  }}>
                    <Edit2 size={12} /> Rename
                  </button>
                  <button onClick={() => {
                    handleDelete(activeChat.id);
                    setMenuOpenForId(null);
                  }} className="delete-opt">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              );
            })()}

            <div className="geo-settings">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                <span>LAB SETTINGS</span>
                <button onClick={handleClearLocalIndex} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }} title="Clear Indexed Target Site">
                  <Trash2 size={12} className="hover-text-primary" />
                </button>
              </div>

              {healthWarnings.length > 0 && (
                <div style={{ background: 'rgba(210, 153, 34, 0.14)', border: '1px solid rgba(210, 153, 34, 0.45)', borderRadius: '0.5rem', padding: '0.45rem 0.55rem', marginBottom: '0.55rem', fontSize: '0.68rem', color: '#f0b849', lineHeight: 1.35 }}>
                  {healthWarnings.map((w, i) => (
                    <div key={i}>⚠ {w}</div>
                  ))}
                </div>
              )}

              <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                Competitor Niche:
              </label>
              <select
                className="input-field"
                value={indexStatus.activeNiche}
                onChange={(e) => handleSelectNiche(e.target.value)}
                disabled={isSwitchingNiche}
                style={{ fontSize: '0.78rem', padding: '0.4rem 0.6rem', marginBottom: '0.6rem', cursor: 'pointer' }}
              >
                {indexStatus.niches.map((n) => (
                  <option key={n.id} value={n.id} style={{ background: '#171717', color: '#ececec' }}>
                    {n.name} ({n.pagesCount}p)
                  </option>
                ))}
                <option value="custom" style={{ background: '#171717', color: '#ececec' }}>
                  Custom (manual competitor URLs)
                </option>
              </select>

              <p style={{fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.35rem'}}>
                Your site URL or sitemap.xml:
              </p>
              <div style={{display: 'flex', gap: '0.4rem'}}>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="https://user.github.io/site/"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  style={{marginBottom: 0, fontSize: '0.78rem'}}
                />
                <button 
                  className="crawl-btn" 
                  onClick={handleCrawl}
                  disabled={isCrawling || !targetUrl.trim()}
                  title="Crawl site or sitemap.xml (replaces active target site)"
                >
                  {crawlSuccess ? <Check size={14} color="var(--text-primary)" /> : <RefreshCw size={14} className={isCrawling ? "spin" : ""} />}
                </button>
              </div>

              {indexStatus.activeNiche === 'custom' && (
                <div style={{ marginTop: '0.6rem' }}>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                    Add competitor URL (custom mode):
                  </p>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="https://competitor.com/"
                      value={competitorUrl}
                      onChange={(e) => setCompetitorUrl(e.target.value)}
                      style={{ marginBottom: 0, fontSize: '0.75rem' }}
                    />
                    <button
                      className="crawl-btn"
                      onClick={handleCrawlCompetitor}
                      disabled={isCrawlingCompetitor || !competitorUrl.trim()}
                      title="Crawl and add competitor URL"
                    >
                      {isCrawlingCompetitor ? <RefreshCw size={13} className="spin" /> : <Plus size={13} />}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ marginTop: '0.6rem', fontSize: '0.7rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                {indexStatus.localSite ? (
                  <>
                    <div style={{ color: '#a371f7', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={indexStatus.localSite.url}>
                      Target: {indexStatus.localSite.url}
                    </div>
                    <div>
                      {indexStatus.localSite.pagesCount} {indexStatus.localSite.pagesCount === 1 ? 'page' : 'pages'} · {indexStatus.localSite.chunksCount} {indexStatus.localSite.chunksCount === 1 ? 'chunk' : 'chunks'}
                    </div>
                  </>
                ) : (
                  <div>No target site indexed yet</div>
                )}

                {indexStatus.activeNicheInfo && (
                  <div style={{ opacity: 0.85, marginTop: '0.2rem' }}>
                    Corpus: {indexStatus.activeNicheInfo.pagesCount} pages · {indexStatus.activeNicheInfo.chunksCount} chunks
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', marginTop: '0.3rem' }}>
                  <button
                    type="button"
                    onClick={() => setActiveTab('fakepedia')}
                    style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left', fontSize: '0.7rem', color: externalSources.fakepedia.enabled ? '#58a6ff' : 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    Fakepedia: {externalSources.fakepedia.enabled && externalSources.fakepedia.chunksCount > 0 ? `On (${externalSources.fakepedia.chunksCount}c)` : 'Off'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('reviews')}
                    style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left', fontSize: '0.7rem', color: externalSources.reviews.enabled ? '#3fb950' : 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    Reviews: {externalSources.reviews.enabled && externalSources.reviews.chunksCount > 0 ? `On (${externalSources.reviews.chunksCount}c)` : 'Off'}
                  </button>
                </div>

                {indexStatus.customCompetitors.length > 0 && (
                  <div style={{ marginTop: '0.3rem' }}>
                    {indexStatus.customCompetitors.map((comp) => (
                      <div key={comp.url} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={comp.url}>
                          Comp: {comp.url} ({comp.pagesCount}p)
                        </span>
                        <button
                          onClick={() => handleRemoveCompetitor(comp.url)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                          title="Remove competitor"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="chat-container">
        <div className="top-nav-tabs">
          <button
            type="button"
            className={`top-nav-tab ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={15} />
            <span>Chat</span>
          </button>
          <button
            type="button"
            className={`top-nav-tab ${activeTab === 'fakepedia' ? 'active' : ''}`}
            onClick={() => setActiveTab('fakepedia')}
          >
            <BookOpen size={15} />
            <span>Fakepedia</span>
            {externalSources.fakepedia.enabled && externalSources.fakepedia.chunksCount > 0 && (
              <span className="tab-active-dot" title="Active in FakeGPT search" />
            )}
          </button>
          <button
            type="button"
            className={`top-nav-tab ${activeTab === 'reviews' ? 'active' : ''}`}
            onClick={() => setActiveTab('reviews')}
          >
            <Star size={15} />
            <span>Totally Unbiased Reviews</span>
            {externalSources.reviews.enabled && externalSources.reviews.chunksCount > 0 && (
              <span className="tab-active-dot" title="Active in FakeGPT search" />
            )}
          </button>
        </div>

        {activeTab === 'fakepedia' ? (
          <FakepediaView
            initial={externalSources.fakepedia}
            onSaved={async () => {
              await fetchExternalSources();
              await fetchIndexStatus();
            }}
          />
        ) : activeTab === 'reviews' ? (
          <ReviewsView
            initial={externalSources.reviews}
            onSaved={async () => {
              await fetchExternalSources();
              await fetchIndexStatus();
            }}
          />
        ) : (
          <>
            {messages.length === 0 ? (
              <div className="hero">
                <h1>What can I help you with?</h1>
              </div>
            ) : (
              <div className="messages-area">
                {messages.map((msg, idx) => {
                  if (msg.role === 'system' || msg.role === 'tool') return null;
                  if (isLoading && idx === messages.length - 1 && msg.role === 'assistant' && msg.content === '') return null;
                  return (
                    <div key={idx} className={`message-wrapper ${msg.role}`}>
                      <div className="message-content">
                        <div className="markdown-body">
                          {msg.thinking && <ThinkingContent thinking={msg.thinking} hasStartedAnswer={!!msg.content} />}
                          <ReactMarkdown rehypePlugins={[rehypeRaw]}>{msg.content}</ReactMarkdown>
                          {msg.sources && <SourcesDropdown sources={msg.sources} content={msg.content} rewrittenQuery={msg.rewrittenQuery} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
                
                {isLoading && (
                  <div className="message-wrapper assistant">
                    <div className="message-content">
                      <div className="markdown-body">
                        <div className="loading-scroll">
                          <span className="loading-pulse"></span>
                          {loadingMessage.type === 'text' ? (
                            <span className="loading-message">{loadingMessage.message}</span>
                          ) : (
                            <span className="loading-message">Checking <a className="loading-message-link" href={loadingMessage.url} target="_blank" rel="noopener noreferrer">{loadingMessage.url?.slice(0, 50)}</a>...</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            <div className="input-area-wrapper">
              <div className="input-box">
                <textarea
                  className="chat-textarea"
                  placeholder="Ask anything"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
                <button 
                  className="send-btn" 
                  onClick={handleSubmit}
                  disabled={!input.trim() || isLoading}
                >
                  <ArrowUp size={16} />
                </button>
              </div>
              <p style={{ 
                position: 'absolute',
                bottom: '0.5rem',
                fontSize: '0.75rem', 
                color: 'white', 
                textAlign: 'center', 
                opacity: 0.5 
              }}>
                FakeGPT is a small LLM and will likely make mistakes. Always remember to verify its responses.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default App;

function ThinkingContent({ thinking, hasStartedAnswer }: { thinking: string; hasStartedAnswer: boolean }) {
  const [isOpen, setIsOpen] = useState(!hasStartedAnswer);
  const hadStartedRef = useRef(hasStartedAnswer);

  useEffect(() => {
    if (!hadStartedRef.current && hasStartedAnswer) {
      setIsOpen(false);
    }
    hadStartedRef.current = hasStartedAnswer;
  }, [hasStartedAnswer]);

  return (
    <div className={`thinking-wrapper ${isOpen ? 'open' : ''}`}>
      <button className="thinking-pill" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? 'Hide thinking' : 'Show thinking'}
      </button>
      <div className={`thinking-animator ${isOpen ? 'open' : ''}`}>
        <div className="thinking-content-inner">
          <div className="thinking-content">
            <ReactMarkdown rehypePlugins={[rehypeRaw]}>{thinking}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

function checkIsCited(content: string, sourceUrl: string, index: number): boolean {
  if (!content) return false;
  const cleanUrl = (sourceUrl || '').trim().replace(/\/+$/, '');
  if (cleanUrl && content.includes(cleanUrl)) return true;

  const sourceNum = index + 1;
  const bracketRegex = new RegExp(`\\[\\[?\\s*${sourceNum}\\s*\\]?\\]`);
  if (bracketRegex.test(content)) return true;

  try {
    const urlObj = new URL(sourceUrl);
    if (urlObj.pathname && urlObj.pathname.length > 1 && content.includes(urlObj.pathname)) {
      return true;
    }
  } catch (_) {}

  return false;
}

function SourcesDropdown({ sources, content, rewrittenQuery }: { sources: any[], content: string, rewrittenQuery?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className={`sources-wrapper ${isOpen ? 'open' : ''}`} style={{ width: '100%', marginTop: '1rem' }}>
      <button 
        className="sources-pill" 
        onClick={() => setIsOpen(!isOpen)}
      >
        View Sources ({sources.length})
      </button>
      <div className={`sources-animator ${isOpen ? 'open' : ''}`}>
        <div className="sources-content-inner">
          {rewrittenQuery && (
            <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <strong>LLM Query Rewrite:</strong> {rewrittenQuery}
            </div>
          )}
          {sources.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)' }}>No sources were retrieved for this query.</div>
          ) : (
            sources.map((c, idx) => {
              const isCited = c.isRelevant !== false && checkIsCited(content, c.source, idx);
              let statusBadge = '';
              if (c.isRelevant === false) {
                statusBadge = '<span style="color: #f85149; font-weight: 600;">[2. Evaluator: Rejected]</span>';
              } else if (isCited) {
                statusBadge = '<span style="color: #58a6ff; font-weight: 600;">[2. Evaluator: Accepted]</span> <span style="color: #3fb950; font-weight: 700; margin-left: 6px;">[3. Cited in Answer]</span>';
              } else {
                statusBadge = '<span style="color: #58a6ff; font-weight: 600;">[2. Evaluator: Accepted]</span> <span style="color: var(--text-secondary); margin-left: 6px;">[3. Read by LLM, Not Cited]</span>';
              }
              
              return (
                <div key={idx} className="source-item">
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                    <strong>{idx + 1}. <a href={c.source} target="_blank" rel="noreferrer">{c.source}</a></strong>
                    <span style={{ fontSize: '0.75rem' }} dangerouslySetInnerHTML={{ __html: statusBadge }} />
                  </div>
                  <span className="source-meta">
                    Stage 1: Ranked #{idx + 1} (Cosine Similarity: {c.similarity.toFixed(3)})
                    {(c.sourceType === 'target' || c.isLocal) && <span style={{ color: '#a371f7', marginLeft: '8px', fontWeight: 600 }}>(Target Site)</span>}
                    {c.sourceType === 'fakepedia' && <span style={{ color: '#58a6ff', marginLeft: '8px', fontWeight: 600 }}>(Fakepedia)</span>}
                    {c.sourceType === 'reviews' && <span style={{ color: '#3fb950', marginLeft: '8px', fontWeight: 600 }}>(Totally Unbiased Reviews)</span>}
                  </span>
                  <em>"{c.chunk.replace(/\n/g, ' ')}"</em>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
