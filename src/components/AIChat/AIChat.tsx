import React, { useState, useEffect, useRef } from 'react';
import { Send, Settings, Bot, User as UserIcon, Terminal } from 'lucide-react';
import { SimpleMcpClient, type McpTool } from '../../services/SimpleMcpClient';
import { chatCompletion, type ChatMessage, type LLMConfig } from '../../services/llmService';
import { getToken } from '../../services/api';
import '../../styles/AIChat.css';

const AIChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: '你好！我是你的日程助手。我可以帮你管理日程、查看邮件等。请先在设置中配置你的大模型 API。' }
  ]);
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

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    if (!config.apiKey) {
      setShowSettings(true);
      return;
    }

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
    <div className="ai-chat-container">
      <div className="chat-header">
        <h2>
          <Bot size={24} /> AI 助手
          <span className={`mcp-status ${mcpConnected ? 'connected' : ''}`}>
            {mcpConnected ? 'MCP 已连接' : 'MCP 未连接'}
          </span>
        </h2>
        <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>
          <Settings size={18} /> 设置
        </button>
      </div>

      {showSettings && (
        <div className="settings-panel">
          <form className="settings-form" onSubmit={handleSaveConfig}>
            <div className="form-row">
              <label>API Base URL</label>
              <input 
                type="text" 
                value={config.baseUrl}
                onChange={e => setConfig({...config, baseUrl: e.target.value})}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div className="form-row">
              <label>API Key</label>
              <input 
                type="password" 
                value={config.apiKey}
                onChange={e => setConfig({...config, apiKey: e.target.value})}
                placeholder="sk-..."
              />
            </div>
            <div className="form-row">
              <label>Model Name</label>
              <input 
                type="text" 
                value={config.model}
                onChange={e => setConfig({...config, model: e.target.value})}
                placeholder="gpt-3.5-turbo"
              />
            </div>
            <button type="submit" className="save-btn">保存配置</button>
          </form>
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
              <div className="tool-result">
                <div className="tool-header">
                  <Terminal size={14} />
                  <span>Tool Output ({msg.name})</span>
                </div>
                <div className="tool-output">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div className="message-content">
                {msg.content}
                {msg.tool_calls && (
                  <div className="tool-calls-preview">
                    {msg.tool_calls.map((tc: any, i: number) => (
                      <div key={i} className="tool-call-badge">
                        🛠️ Calling: {tc.function.name}
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
          <textarea
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="输入指令，例如：帮我把明天的会议加到日程里..."
            disabled={loading}
          />
          <button className="send-btn" onClick={handleSend} disabled={loading || !input.trim()}>
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChat;
