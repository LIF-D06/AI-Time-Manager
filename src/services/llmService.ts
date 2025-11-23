import { getToken } from './api';

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  name?: string; // for tool role
  tool_calls?: any[];
}

export async function chatCompletion(
  messages: ChatMessage[],
  config: LLMConfig,
  tools?: any[]
): Promise<ChatMessage> {
  // 如果没有提供 API Key，尝试使用服务端的流式接口
  if (!config.apiKey) {
    return await serverChatCompletion(messages, tools);
  }

  // Ensure baseUrl ends with /v1 if not present, or just use as is if user provides full path?
  // Usually users provide "https://api.openai.com/v1" or "https://api.deepseek.com"
  // We'll assume the user provides the base URL up to the point where /chat/completions is appended.
  // If the user provides "https://api.openai.com/v1", we append "/chat/completions".
  
  let baseUrl = config.baseUrl.replace(/\/$/, '');
  // Simple heuristic: if it doesn't end in /v1 and doesn't look like a full path, maybe append /v1?
  // But let's trust the user input or just append /chat/completions.
  
  const url = `${baseUrl}/chat/completions`;
  
  const body: any = {
    model: config.model,
    messages: messages,
    stream: false
  };

  const formattedTools = formatTools(tools);
  if (formattedTools) {
    body.tools = formattedTools;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API Error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices[0];
  return choice.message;
}

async function serverChatCompletion(messages: ChatMessage[], tools?: any[]): Promise<ChatMessage> {
  const token = getToken();
  if (!token) {
    throw new Error('User not authenticated');
  }

  const body: any = { messages };
  const formattedTools = formatTools(tools);
  if (formattedTools) {
    body.tools = formattedTools;
  }

  const response = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Server LLM Error: ${response.status} ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }

  let content = '';
  const toolCallsMap: Record<number, any> = {};
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6);
        if (dataStr === '[DONE]') continue;

        try {
          const data = JSON.parse(dataStr);
          if (data.error) {
            throw new Error(data.error);
          }
          if (data.content) {
            content += data.content;
          }
          if (data.tool_calls) {
            for (const tc of data.tool_calls) {
              const index = tc.index;
              if (!toolCallsMap[index]) {
                toolCallsMap[index] = {
                  id: tc.id,
                  type: tc.type,
                  function: { name: "", arguments: "" }
                };
              }
              if (tc.id) toolCallsMap[index].id = tc.id;
              if (tc.type) toolCallsMap[index].type = tc.type;
              if (tc.function) {
                if (tc.function.name) toolCallsMap[index].function.name += tc.function.name;
                if (tc.function.arguments) toolCallsMap[index].function.arguments += tc.function.arguments;
              }
            }
          }
        } catch (e) {
          // Ignore parse errors for partial chunks
        }
      }
    }
  }

  const tool_calls = Object.values(toolCallsMap);

  return {
    role: 'assistant',
    content: content || null,
    tool_calls: tool_calls.length > 0 ? tool_calls : undefined
  };
}

function formatTools(tools?: any[]) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool: any) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}
