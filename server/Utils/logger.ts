export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

export class Logger {
  private static instance: Logger;
  private level: LogLevel = LogLevel.INFO;

  private constructor() {
    // 从环境变量读取日志等级
    this.loadLogLevelFromEnv();
  }

  private loadLogLevelFromEnv(): void {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    console.log(`🔧 读取环境变量 LOG_LEVEL: ${envLevel || '未设置'}`);
    
    switch (envLevel) {
      case 'debug':
        this.level = LogLevel.DEBUG;
        break;
      case 'info':
        this.level = LogLevel.INFO;
        break;
      case 'warn':
        this.level = LogLevel.WARN;
        break;
      case 'error':
        this.level = LogLevel.ERROR;
        break;
      case 'none':
        this.level = LogLevel.NONE;
        break;
      default:
        this.level = LogLevel.INFO;
    }
    
    console.log(`📊 当前日志等级: ${this.getLevelName()}`);
  }

  private getLevelName(): string {
    switch (this.level) {
      case LogLevel.DEBUG: return 'DEBUG';
      case LogLevel.INFO: return 'INFO';
      case LogLevel.WARN: return 'WARN';
      case LogLevel.ERROR: return 'ERROR';
      case LogLevel.NONE: return 'NONE';
      default: return 'INFO';
    }
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
    console.log(`📊 日志等级已设置为: ${this.getLevelName()}`);
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public reloadFromEnv(): void {
    this.loadLogLevelFromEnv();
  }

  public debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`🐛 [DEBUG] ${message}`, ...args);
    }
  }

  public info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`ℹ️ [INFO] ${message}`, ...args);
    }
  }

  public warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`⚠️ [WARN] ${message}`, ...args);
    }
  }

  public error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`❌ [ERROR] ${message}`, ...args);
    }
  }

  public success(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`✅ [SUCCESS] ${message}`, ...args);
    }
  }

  public start(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`🚀 [START] ${message}`, ...args);
    }
  }

  public step(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`📋 [STEP] ${message}`, ...args);
    }
  }

  public data(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`📊 [DATA] ${message}`, ...args);
    }
  }

  public network(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`🌐 [NETWORK] ${message}`, ...args);
    }
  }

  public exchange(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`📧 [EXCHANGE] ${message}`, ...args);
    }
  }

  public graph(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`🔗 [GRAPH] ${message}`, ...args);
    }
  }

  public auth(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`🔐 [AUTH] ${message}`, ...args);
    }
  }

  public mcp(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`🔧 [MCP] ${message}`, ...args);
    }
  }
}

// 导出单例实例
export const logger = Logger.getInstance();
