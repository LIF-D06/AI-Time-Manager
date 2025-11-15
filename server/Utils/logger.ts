import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 注意：编译后在dist目录运行，但.env文件在server目录
const envPath = path.resolve(__dirname, '..' , '..', '.env');
const dotenvResult = dotenv.config({ path: envPath });

if (dotenvResult.error) {
    console.error('错误: 无法加载.env文件:', dotenvResult.error.message);
} else {
    console.info('.env文件成功加载');
}

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
  private logToFile: boolean = false;
  private logFilePath: string = '';
  private maxFileSize: number = 10 * 1024 * 1024; // 10MB
  private maxFiles: number = 5;

  private constructor() {
    // 从环境变量读取日志等级
    this.loadLogLevelFromEnv();
    // 从环境变量读取文件日志配置
    this.loadFileConfigFromEnv();
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

  private loadFileConfigFromEnv(): void {
    const logToFile = process.env.LOG_TO_FILE?.toLowerCase() === 'true';
    const logFilePath = process.env.LOG_FILE_PATH || path.join(process.cwd(), 'logs', 'app.log');
    const maxFileSize = parseInt(process.env.LOG_MAX_FILE_SIZE || '10485760'); // 10MB default
    const maxFiles = parseInt(process.env.LOG_MAX_FILES || '5');

    this.logToFile = logToFile;
    this.logFilePath = logFilePath;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;

    if (this.logToFile) {
      console.log(`📝 文件日志已启用，日志文件路径: ${this.logFilePath}`);
      this.ensureLogDirectoryExists();
    }
  }

  private ensureLogDirectoryExists(): void {
    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
      console.log(`📁 创建日志目录: ${logDir}`);
    }
  }

  private rotateLogFile(): void {
    if (!fs.existsSync(this.logFilePath)) {
      return;
    }

    const stats = fs.statSync(this.logFilePath);
    if (stats.size >= this.maxFileSize) {
      const logDir = path.dirname(this.logFilePath);
      const logFileName = path.basename(this.logFilePath, path.extname(this.logFilePath));
      const logFileExt = path.extname(this.logFilePath);

      // 删除最旧的日志文件
      const oldestLogFile = path.join(logDir, `${logFileName}.${this.maxFiles}${logFileExt}`);
      if (fs.existsSync(oldestLogFile)) {
        fs.unlinkSync(oldestLogFile);
      }

      // 重命名现有的日志文件
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldFile = path.join(logDir, `${logFileName}.${i}${logFileExt}`);
        const newFile = path.join(logDir, `${logFileName}.${i + 1}${logFileExt}`);
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }

      // 重命名当前日志文件
      const firstRotatedFile = path.join(logDir, `${logFileName}.1${logFileExt}`);
      fs.renameSync(this.logFilePath, firstRotatedFile);
    }
  }

  private writeToFile(level: string, message: string, ...args: any[]): void {
    if (!this.logToFile) {
      return;
    }

    try {
      this.rotateLogFile();
      
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [${level}] ${message}`;
      const argsStr = args.length > 0 ? ' ' + args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ') : '';
      
      const fullLogMessage = logMessage + argsStr + '\n';
      fs.appendFileSync(this.logFilePath, fullLogMessage, 'utf8');
    } catch (error) {
      console.error('❌ 写入日志文件失败:', error);
    }
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
    this.loadFileConfigFromEnv();
  }

  public enableFileLogging(logFilePath?: string, maxFileSize?: number, maxFiles?: number): void {
    this.logToFile = true;
    if (logFilePath) this.logFilePath = logFilePath;
    if (maxFileSize) this.maxFileSize = maxFileSize;
    if (maxFiles) this.maxFiles = maxFiles;
    
    this.ensureLogDirectoryExists();
    console.log(`📝 文件日志已启用，日志文件路径: ${this.logFilePath}`);
  }

  public disableFileLogging(): void {
    this.logToFile = false;
    console.log('📝 文件日志已禁用');
  }

  public isFileLoggingEnabled(): boolean {
    return this.logToFile;
  }

  public getLogFilePath(): string {
    return this.logFilePath;
  }

  public debug(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`🐛 [DEBUG] ${message}`, ...args);
      this.writeToFile('DEBUG', message, ...args);
    }
  }

  public info(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`ℹ️ [INFO] ${message}`, ...args);
      this.writeToFile('INFO', message, ...args);
    }
  }

  public warn(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`⚠️ [WARN] ${message}`, ...args);
      this.writeToFile('WARN', message, ...args);
    }
  }

  public error(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`❌ [ERROR] ${message}`, ...args);
      this.writeToFile('ERROR', message, ...args);
    }
  }

  public success(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`✅ [SUCCESS] ${message}`, ...args);
      this.writeToFile('SUCCESS', message, ...args);
    }
  }

  public start(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`🚀 [START] ${message}`, ...args);
      this.writeToFile('START', message, ...args);
    }
  }

  public step(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`📋 [STEP] ${message}`, ...args);
      this.writeToFile('STEP', message, ...args);
    }
  }

  public data(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`📊 [DATA] ${message}`, ...args);
      this.writeToFile('DATA', message, ...args);
    }
  }

  public network(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`🌐 [NETWORK] ${message}`, ...args);
      this.writeToFile('NETWORK', message, ...args);
    }
  }

  public exchange(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`📧 [EXCHANGE] ${message}`, ...args);
      this.writeToFile('EXCHANGE', message, ...args);
    }
  }

  public graph(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`🔗 [GRAPH] ${message}`, ...args);
      this.writeToFile('GRAPH', message, ...args);
    }
  }

  public auth(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`🔐 [AUTH] ${message}`, ...args);
      this.writeToFile('AUTH', message, ...args);
    }
  }

  public mcp(message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`🔧 [MCP] ${message}`, ...args);
      this.writeToFile('MCP', message, ...args);
    }
  }
}

// 导出单例实例
export const logger = Logger.getInstance();
