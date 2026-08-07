import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { ArrowUp, RefreshCw, Check, PanelLeftClose, SquarePen, Trash2, MoreHorizontal, Edit2, X } from 'lucide-react';
import './index.css';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    fetchChats();
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

  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  const handleClearIndex = async () => {
    try {
      const res = await fetch('/api/clear-index', { method: 'POST' });
      if (res.ok) {
        setTargetUrl('');
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error(`Failed to clear index: ${errData.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      console.error(`Error clearing index: ${e.message}`);
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

      // Refresh chat list to update title
      fetchChats();
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
                <button onClick={handleClearHistory} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }} title="Clear Chat History">
                  <Trash2 size={12} className="hover-text-primary" />
                </button>
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
                <button onClick={handleClearIndex} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }} title="Clear RAG Index">
                  <Trash2 size={12} className="hover-text-primary" />
                </button>
              </div>
              <p style={{fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem'}}>
                Enter your target website URL to optimize:
              </p>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="http://localhost:8000"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  style={{marginBottom: 0}}
                />
                <button 
                  className="crawl-btn" 
                  onClick={handleCrawl}
                  disabled={isCrawling || !targetUrl.trim()}
                  title="Crawl and rebuild index"
                >
                  {crawlSuccess ? <Check size={14} color="var(--text-primary)" /> : <RefreshCw size={14} className={isCrawling ? "spin" : ""} />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="chat-container">
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

function SourcesDropdown({ sources, content, rewrittenQuery }: { sources: any[], content: string, rewrittenQuery?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className={`sources-wrapper ${isOpen ? 'open' : ''}`} style={{ width: '100%', marginTop: '1rem' }}>
      <button 
        className="sources-pill" 
        onClick={() => setIsOpen(!isOpen)}
      >
        View Sources
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
              let statusBadge = '';
              if (c.isRelevant === false) {
                statusBadge = '<span style="color: #f85149;">Rejected by Evaluator LLM</span>';
              } else {
                const isCited = content.includes(c.source);
                statusBadge = isCited ? '<span style="color: #3fb950;">Cited</span>' : '<span style="color: var(--text-secondary);">Read by LLM (Not Cited)</span>';
              }
              
              return (
                <div key={idx} className="source-item">
                  <strong>{idx + 1}. <a href={c.source} target="_blank">{c.source}</a></strong>
                  <span style={{ fontSize: '0.75rem', marginLeft: '8px' }} dangerouslySetInnerHTML={{ __html: statusBadge }} />
                  <span className="source-meta">Cosine Similarity: {c.similarity.toFixed(3)}</span>
                  {c.isLocal && <span className="source-meta" style={{ color: '#a371f7' }}>(Local Index)</span>}
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
