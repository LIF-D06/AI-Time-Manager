import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Settings, Bot, User as UserIcon, Terminal, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import { SimpleMcpClient, type McpTool } from '../../services/SimpleMcpClient';
import { chatCompletion, type ChatMessage, type LLMConfig } from '../../services/llmService';
import { getToken } from '../../services/api';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Badge } from '../ui/Badge';
import '../../styles/AIChat.css';

const ToolMessage: React.FC<{ content: string; name: string }> = ({ content, name }) => {
  const [expanded, setExpanded] = useState(false);
  let parsedContent: any = content;
  let isJson = false;
  try {
    parsedContent = JSON.parse(content);
    isJson = true;
  } catch (e) {
    // ignore
  }

  return (
    <div className="tool-result-container">
      <div className="tool-result-header" onClick={() => setExpanded(!expanded)}>
        <div className="tool-info">
          <CheckCircle2 size={14} style={{ color: 'var(--color-success)' }} />
          <span className="tool-name">调用成功: {name}</span>
        </div>
        <div className="tool-toggle">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>
      {expanded && (
        <div className="tool-result-body">
          <pre>{isJson ? JSON.stringify(parsedContent, null, 2) : content}</pre>
        </div>
      )}
    </div>
  );
};

const AIChat: React.FC = () => {
  const STORAGE_KEY = 'mcp_chat_history';

  const defaultWelcome: ChatMessage = { role: 'assistant', content: '我可以帮你管理邮件、日程、任务和时间查询。你想让我帮你做什么？' };

  const [messages, setMessages] = useState<ChatMessage[]>([defaultWelcome]);

  // Load saved messages from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch (e) {
      console.warn('Failed to load MCP chat history:', e);
    }
  }, []);

  // Persist messages to localStorage when they change
  useEffect(() => {
    // Skip saving on the very first render to avoid overwriting existing storage
    if ((isInitialMount as any).current === true) {
      (isInitialMount as any).current = false;
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      // console.debug('Saved MCP chat history', messages.length);
    } catch (e) {
      console.warn('Failed to save MCP chat history:', e);
    }
  }, [messages]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mcpConnected, setMcpConnected] = useState(false);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [config, setConfig] = useState<LLMConfig>({
    baseUrl: localStorage.getItem('llm_baseUrl') || 'https://api.openai.com/v1',
    apiKey: localStorage.getItem('llm_apiKey') || '',
    model: localStorage.getItem('llm_model') || 'gpt-3.5-turbo'
  });

  const mcpClientRef = useRef<SimpleMcpClient | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const client = new SimpleMcpClient(token);
    mcpClientRef.current = client;

    client.connect(
      () => {
        setMcpConnected(true);
        // Fetch tools once connected
        client.listTools().then(setTools).catch(console.error);
      },
      (err) => {
        console.error('MCP Connection Error:', err);
        setMcpConnected(false);
      }
    );

    return () => {
      client.close();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('llm_baseUrl', config.baseUrl);
    localStorage.setItem('llm_apiKey', config.apiKey);
    localStorage.setItem('llm_model', config.model);
    setShowSettings(false);
  };

  const clearHistory = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear MCP chat history:', e);
    }
    setMessages([defaultWelcome]);
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    // Remove the check for apiKey to allow fallback to server LLM
    // if (!config.apiKey) {
    //   setShowSettings(true);
    //   return;
    // }

    const userMsg: ChatMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      let currentMessages = [...messages, userMsg];
      
      // First call to LLM
      let response = await chatCompletion(currentMessages, config, tools);
      
      // Loop for tool calls
      while (response.tool_calls && response.tool_calls.length > 0) {
        // Add assistant message with tool calls
        currentMessages.push(response);
        setMessages([...currentMessages]); // Update UI to show thinking/tool usage?

        // Execute tools
        for (const toolCall of response.tool_calls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          
          // Add tool result message placeholder
          const toolMsgId = toolCall.id;
          
          try {
            if (!mcpClientRef.current) throw new Error('MCP Client not connected');
            
            const result = await mcpClientRef.current.callTool(toolName, args);
            
            const toolResultMsg: ChatMessage = {
              role: 'tool',
              tool_call_id: toolMsgId,
              name: toolName,
              content: JSON.stringify(result)
            };
            
            currentMessages.push(toolResultMsg);
          } catch (err: any) {
            const errorMsg: ChatMessage = {
              role: 'tool',
              tool_call_id: toolMsgId,
              name: toolName,
              content: JSON.stringify({ error: err.message })
            };
            currentMessages.push(errorMsg);
          }
        }
        
        // Update UI with tool results
        setMessages([...currentMessages]);

        // Call LLM again with tool results
        response = await chatCompletion(currentMessages, config, tools);
      }

      // Final response
      currentMessages.push(response);
      setMessages(currentMessages);

    } catch (err: any) {
      console.error('Chat Error:', err);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `Error: ${err.message}. Please check your API settings.` 
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="ai-chat-container">
      <CardHeader className="chat-header">
        <CardTitle>
          <Bot size={24} /> AI 助手
          <Badge variant={mcpConnected ? 'success' : 'error'} style={{ marginLeft: '10px' }}>
            {mcpConnected ? 'MCP 已连接' : 'MCP 未连接'}
          </Badge>
        </CardTitle>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings size={18} style={{ marginRight: '6px' }} /> 设置
          </Button>
          <Button 
            variant="outline"
            size="sm"
            onClick={clearHistory}
          >
            清除历史
          </Button>
        </div>
      </CardHeader>

      {showSettings && (
        <div className="settings-panel">
          <Card>
            <CardContent style={{ paddingTop: '20px' }}>
              <form className="settings-form" onSubmit={handleSaveConfig}>
                <Input
                  label="API Base URL"
                  type="text"
                  value={config.baseUrl}
                  onChange={e => setConfig({...config, baseUrl: e.target.value})}
                  placeholder="https://api.openai.com/v1"
                />
                <Input
                  label="API Key"
                  type="password"
                  value={config.apiKey}
                  onChange={e => setConfig({...config, apiKey: e.target.value})}
                  placeholder="sk-..."
                />
                <Input
                  label="Model Name"
                  type="text"
                  value={config.model}
                  onChange={e => setConfig({...config, model: e.target.value})}
                  placeholder="gpt-3.5-turbo"
                />
                <Button type="submit">保存配置</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            {msg.role !== 'tool' && (
              <div className="avatar">
                {msg.role === 'user' ? <UserIcon size={20} /> : <Bot size={20} />}
              </div>
            )}
            
            {msg.role === 'tool' ? (
              <ToolMessage content={msg.content || ''} name={msg.name || 'Unknown Tool'} />
            ) : (
              <div className="message-content markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg.content}
                </ReactMarkdown>
                {msg.tool_calls && (
                  <div className="tool-calls-preview">
                    {msg.tool_calls.map((tc: any, i: number) => (
                      <div key={i} className="tool-call-item">
                        <Terminal size={14} />
                        <span>正在执行: {tc.function.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="message assistant">
            <div className="avatar"><Bot size={20} /></div>
            <div className="message-content">
              <div className="loading-dots">
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <div className="input-wrapper">
          <Textarea
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="e.g. 帮我添加最近邮件中的日程"
            disabled={loading}
            style={{ minHeight: '50px', height: '50px' }}
          />
          <Button 
            className="send-btn" 
            onClick={handleSend} 
            disabled={loading || !input.trim()}
            style={{ height: '50px', width: '50px', padding: 0 }}
          >
            <Send size={20} />
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default AIChat;
