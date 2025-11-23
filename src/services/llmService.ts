
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

  if (tools && tools.length > 0) {
    body.tools = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }));
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
