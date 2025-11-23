import React, { useState, useEffect, useRef } from 'react';
import { Send, Settings, Bot, User as UserIcon, Terminal } from 'lucide-react';
import { SimpleMcpClient, type McpTool } from '../../services/SimpleMcpClient';
import { chatCompletion, type ChatMessage, type LLMConfig } from '../../services/llmService';
import { getToken } from '../../services/api';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Badge } from '../ui/Badge';
import '../../styles/AIChat.css';

const AIChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: `我可以帮你做以下几类事情：

## 📧 邮件管理
- 查看最近的邮件内容

## 📅 日程管理
- 添加新的日程/任务
- 查看特定时间范围内的日程安排
- 更新现有的日程信息
- 删除不需要的日程
- 标记任务完成状态

## ⏰ 时间相关
- 获取当前服务器时间

具体来说，我可以：
- 从邮件中提取会议、任务信息并自动添加到日程
- 帮你整理一周或一个月的日程安排
- 设置提醒和任务优先级
- 管理会议、待办事项等不同类型的日程

你想让我帮你处理什么具体的事情呢？比如查看今天的日程，或者从邮件中提取重要信息添加到日历中？` }
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
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setShowSettings(!showSettings)}
        >
          <Settings size={18} style={{ marginRight: '6px' }} /> 设置
        </Button>
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
                        <Badge variant="info">🛠️ Calling: {tc.function.name}</Badge>
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
