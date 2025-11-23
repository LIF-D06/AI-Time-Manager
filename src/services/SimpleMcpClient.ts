
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
}

export class SimpleMcpClient {
  private eventSource: EventSource | null = null;
  private endpoint: string | null = null;
  private _onOpen: (() => void) | null = null;
  private _onError: ((err: any) => void) | null = null;
  private pendingRequests = new Map<string | number, { resolve: (val: any) => void, reject: (err: any) => void }>();
  private nextId = 1;

  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  connect(onOpen: () => void, onError: (err: any) => void) {
    this._onOpen = onOpen;
    this._onError = onError;

    // Connect to SSE
    // Note: We pass the token in the query string because EventSource doesn't support headers
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
    this.eventSource = new EventSource(`${baseUrl}/api/mcp/sse?token=${encodeURIComponent(this.token)}`);

    this.eventSource.onopen = () => {
      console.log('MCP SSE Connected');
    };

    this.eventSource.onerror = (err) => {
      // EventSource error handling is tricky, it often retries automatically
      console.error('MCP SSE Error', err);
      // Only report error if we haven't established a connection yet or if it's fatal
      // if (this._onError) this._onError(err);
    };

    // Listen for the 'endpoint' event which tells us where to POST messages
    this.eventSource.addEventListener('endpoint', (event: any) => {
      const data = event.data; 
      // If data is relative, prepend the backend URL
      if (data.startsWith('/')) {
          const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
          this.endpoint = `${baseUrl}${data}`;
      } else {
          this.endpoint = data;
      }
      console.log('MCP Endpoint received:', this.endpoint);
      
      // Start handshake
      this.initialize();
    });

    this.eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (e) {
        console.error('Failed to parse MCP message', e);
      }
    };
  }

  private handleMessage(msg: any) {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      if (msg.error) {
        reject(msg.error);
      } else {
        resolve(msg.result);
      }
    } else {
      // Notification or request from server
      console.log('Received MCP message:', msg);
    }
  }

  private async send(method: string, params?: any): Promise<any> {
    if (!this.endpoint) throw new Error('MCP Endpoint not ready');

    const id = this.nextId++;
    const msg = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      fetch(this.endpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      }).then(async (res) => {
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`MCP Post failed: ${res.status} ${text}`);
        }
        // The response to the POST is usually just "Accepted" or similar.
        // The actual JSON-RPC response comes via SSE.
        // However, some implementations might return the response directly if it's immediate?
        // The MCP spec says responses come via the transport (SSE).
      }).catch(err => {
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  private sendNotification(method: string, params?: any) {
    if (!this.endpoint) return;
    const msg = {
      jsonrpc: '2.0',
      method,
      params
    };
    fetch(this.endpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
    }).catch(console.error);
  }

  private async initialize() {
    try {
      const result = await this.send('initialize', {
        protocolVersion: '2024-11-05', 
        capabilities: {
          roots: { listChanged: true },
          sampling: {}
        },
        clientInfo: {
          name: 'TimeManagerWeb',
          version: '1.0.0'
        }
      });
      console.log('MCP Initialized:', result);
      
      this.sendNotification('notifications/initialized');
      
      if (this._onOpen) this._onOpen();
    } catch (err) {
      console.error('MCP Initialization failed', err);
      if (this._onError) this._onError(err);
    }
  }

  async listTools(): Promise<McpTool[]> {
    const res = await this.send('tools/list');
    return res.tools;
  }

  async callTool(name: string, args: any): Promise<any> {
    const res = await this.send('tools/call', {
      name,
      arguments: args
    });
    return res;
  }

  close() {
    if (this.eventSource) {
      this.eventSource.close();
    }
  }
}
