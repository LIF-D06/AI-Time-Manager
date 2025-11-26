type MessageHandler = (data: any) => void;

class WSClient {
  private socket: WebSocket | null = null;
  private url: string | null = null;
  private token: string | null = null;
  private reconnectDelay = 1000;
  private maxReconnect = 30000;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private globalHandlers: Set<MessageHandler> = new Set();
  private isClosing = false;

  connectIfNeeded(token: string) {
    if (!token) return;
    // if already connected with same token, noop
    if (this.socket && this.token === token && this.socket.readyState === WebSocket.OPEN) return;
    this.token = token;
    this.url = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/^http/, 'ws').replace(/^https/, 'wss') + `/ws?token=${token}`;
    this.isClosing = false;
    this.setupSocket();
  }

  private setupSocket() {
    if (!this.url) return;
    try {
      if (this.socket) {
        try { this.socket.close(); } catch(_) {}
        this.socket = null;
      }
      this.socket = new WebSocket(this.url);
      this.socket.onopen = () => {
        this.reconnectDelay = 1000;
      };
      this.socket.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          this.dispatch(data);
        } catch (e) {
          // ignore
        }
      };
      this.socket.onclose = () => {
        if (this.isClosing) return;
        setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnect);
          this.setupSocket();
        }, this.reconnectDelay);
      };
      this.socket.onerror = () => {
        // close will trigger reconnect
      };
    } catch (e) {
      // schedule reconnect
      setTimeout(() => this.setupSocket(), this.reconnectDelay);
    }
  }

  disconnect() {
    this.isClosing = true;
    if (this.socket) {
      try { this.socket.close(); } catch(_) {}
      this.socket = null;
    }
  }

  subscribe(type: string | null, handler: MessageHandler) {
    if (!type) {
      this.globalHandlers.add(handler);
      return () => this.globalHandlers.delete(handler);
    }
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)!.delete(handler);
  }

  private dispatch(data: any) {
    // call global handlers
    for (const h of this.globalHandlers) {
      try { h(data); } catch(_) {}
    }
    if (!data || !data.type) return;
    const set = this.handlers.get(data.type);
    if (!set) return;
    for (const h of set) {
      try { h(data); } catch(_) {}
    }
  }
}

const wsClient = new WSClient();
export default wsClient;
