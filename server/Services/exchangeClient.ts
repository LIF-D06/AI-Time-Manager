import {
    ExchangeService,
    ExchangeVersion,
    WebCredentials,
    Uri,
    WellKnownFolderName,
    SearchFilter,
    ItemView,
    PropertySet,
    BasePropertySet,
    EmailMessage,
    Appointment,
    CalendarView,
    DateTime,
    SendInvitationsMode,
    Mailbox,
    ItemSchema,
    EmailMessageSchema,
    AppointmentSchema,
    ItemId,
    FolderId,
    TraceFlags,
    StreamingSubscription,
    StreamingSubscriptionConnection,
    EventType,
    MessageBody,
    NotificationEvent,
    Importance,
} from 'ews-javascript-api';
import { ExchangeConfig, IEmail, IEvent } from './types';
import { logger } from '../Utils/logger.js';
import moment from 'moment-timezone';
import { LLMApi } from './LLMApi.js';
import { createTodoItem } from './MStodo.js';
import { User, Task } from '../index.js';
import { v4 as uuidv4 } from 'uuid';
import { mcpTools } from './mcp.js';

// 以下代码将禁用 SSL/TLS 证书验证。
// 如果您的 Exchange 服务器使用自签名证书，则需要此设置。
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// 为 ews-javascript-api 设置时区
moment.tz.setDefault("Asia/Shanghai");

export class ExchangeClient {
    private config: ExchangeConfig;
    private service: ExchangeService;
    private streamingSubscription: StreamingSubscription | null = null;
    private streamingConnection: StreamingSubscriptionConnection | null = null;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private llmApi: LLMApi | null = null;
    private user: User | null = null;
    private processedMessageIds: Set<string> = new Set();

    constructor(config: ExchangeConfig, user: User) {
        this.config = config;
        logger.exchange('使用 ews-javascript-api 初始化 Exchange 客户端...');

        // 创建 ExchangeService 实例
        this.service = new ExchangeService(ExchangeVersion.Exchange2013_SP1);

        this.user = user;
        
        // 初始化 LLM API 客户端
        if (config.openaiApiKey) {
            this.llmApi = new LLMApi(config.openaiApiKey, config.openaiModel || 'gpt-4o') as LLMApi;
        } else {
            logger.warn('未提供 OpenAI API Key，无法使用邮件智能处理功能');

        }

        // 根据是否存在 domain 来决定用户名的格式
        const username = this.config.domain 
            ? `${this.config.domain}\\${this.config.username}` 
            : this.config.username;
        
        this.service.Credentials = new WebCredentials(username, this.config.password);
        
        // 启用跟踪以进行调试
        this.service.TraceEnabled = true;
        this.service.TraceFlags = TraceFlags.All;
        this.service.TraceListener = {
            Trace: (traceType: string, traceMessage: string) => {
                logger.data(`[EWS-TRACE] ${traceType}: ${traceMessage}`);
            }
        };

        logger.data(`使用的用户名 (格式化后): ${username}`);
        logger.data(`域名: ${this.config.domain || '未设置'}`);
        logger.exchange('客户端初始化完成。将在首次请求时使用 Autodiscover。');

        // 初始化后立即测试日历连接并启动推送通知
        (async () => {
            try {
                logger.exchange('初始化时测试日历连接...');
                const start = new Date();
                const end = new Date();
                end.setDate(start.getDate() + 1); // 获取到明天为止的事件
                
                const events = await this.getEvents(start.toISOString(), end.toISOString());
                logger.success(`日历连接测试成功，获取到未来24小时内的 ${events.length} 个事件。`);
                
                // 启动推送通知订阅
                await this.startPushNotifications();
            } catch (error) {
                // 错误已在 getEvents 中记录，这里只记录测试失败的上下文
                logger.error('初始化日历连接测试失败。');
            }
        })();
    }

    /**
     * 确保已执行 Autodiscover 并设置了 EWS URL
     */
    private async ensureAutodiscover(): Promise<void> {
        if (!this.service.Url) {
            logger.exchange('执行 Autodiscover 或修正配置的 URL 以查找 EWS 端点...');
            try {
                // 如果提供了 exchangeUrl，则直接使用，否则执行 Autodiscover
                if (this.config.exchangeUrl) {
                    let ewsUrl = this.config.exchangeUrl;
                    // 确保 URL 指向 EWS 端点
                    if (!ewsUrl.toLowerCase().endsWith('/ews/exchange.asmx')) {
                        if (!ewsUrl.endsWith('/')) {
                            ewsUrl += '/';
                        }
                        ewsUrl += 'EWS/Exchange.asmx';
                    }
                    this.service.Url = new Uri(ewsUrl);
                    logger.success(`已使用修正后的 EWS URL: ${this.service.Url.AbsoluteUri}`);
                } else {
                    await this.service.AutodiscoverUrl(this.config.username, (url) => this.redirectionUrlValidationCallback(url));
                    logger.success(`Autodiscover 成功。EWS URL 设置为: ${(this.service.Url && (this.service.Url as Uri).AbsoluteUri) || '未知'}`);
                }
            } catch (err) {
                logger.error('Autodiscover 或 URL 设置失败: ' + (err instanceof Error ? err.message : err));
                throw err;
            }
        }
    }
    
    // 启动推送通知
    public async startPushNotifications() {
        try {
            await this.ensureAutodiscover();
            
            logger.exchange('启动Exchange推送通知服务...');
            
            // 停止现有连接
            if (this.streamingConnection) {
                await this.stopPushNotifications();
            }
            
            try {
                // 创建流订阅，监听收件箱的新邮件事件和日历的新事件
                const inboxFolderId = new FolderId(WellKnownFolderName.Inbox);
                const calendarFolderId = new FolderId(WellKnownFolderName.Calendar);
                this.streamingSubscription = await this.service.SubscribeToStreamingNotifications(
                    [inboxFolderId, calendarFolderId],
                    EventType.NewMail, EventType.Created, EventType.Modified
                );
                logger.exchange('成功创建推送通知订阅（邮件和日历）。');
            } catch (subscriptionError: any) {
                logger.error('创建推送通知订阅失败:', subscriptionError.message || '未知错误');
                // 等待更长时间后重试订阅创建
                setTimeout(() => this.startPushNotifications().catch(err => {}), 10000);
                return;
            }
            
            // 创建流连接
            this.streamingConnection = new StreamingSubscriptionConnection(this.service, 30); // 30分钟连接超时
            
            // 添加订阅
            this.streamingConnection.AddSubscription(this.streamingSubscription);
            
            // 添加事件处理程序
            this.streamingConnection.OnNotificationEvent.push(async (sender, args) => {
                try {
                    await this.handleNotificationEvent(args.Events);
                } catch (eventError: any) {
                    logger.error('处理通知事件时出错:', eventError.message || '未知错误');
                }
            });
            
            this.streamingConnection.OnDisconnect.push((sender, args) => {
                logger.exchange('推送通知连接已断开。正在尝试重新连接...');
                // 重新连接
                setTimeout(() => this.startPushNotifications().catch(err => 
                    logger.error('重新连接推送通知失败:', err.message || '未知错误')
                ), 5000);
            });
            
            this.streamingConnection.OnSubscriptionError.push((sender, args) => {
                logger.error('推送通知订阅错误:', args.Exception?.Message || '未知错误');
                // 订阅错误时也尝试重新连接
                setTimeout(() => this.startPushNotifications().catch(err => {}), 5000);
            });
            
            // 连接并开始监听
            await this.streamingConnection.Open();
            logger.success('Exchange推送通知服务已启动并开始监听新邮件。');
            
            // 启动健康检查
            this.startHealthCheck();
        } catch (error: any) {
            logger.error('启动Exchange推送通知服务失败:', error.message || '未知错误');
            // 5秒后重试
            setTimeout(() => this.startPushNotifications().catch(err => {}), 5000);
        }
    }
    
    // 停止推送通知
    public async stopPushNotifications() {
        try {
            // 停止健康检查
            this.stopHealthCheck();
            
            if (this.streamingConnection) {
                await this.streamingConnection.Close();
                this.streamingConnection = null;
            }
            
            this.streamingSubscription = null;
            logger.exchange('推送通知服务已停止。');
        } catch (error: any) {
            logger.error('停止推送通知服务时出错:', error.message || '未知错误');
        }
    }
    
    // 停止健康检查
    private stopHealthCheck() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
            logger.exchange('推送通知健康检查已停止。');
        }
    }
    
    // 清理资源（用于应用关闭时）
    public async dispose() {
        logger.exchange('开始清理Exchange客户端资源...');
        await this.stopPushNotifications();
        logger.success('Exchange客户端资源清理完成。');
    }
    
    // 处理推送通知事件
    private async handleNotificationEvent(events: {EventType: EventType, ItemId?: {UniqueId: string}}[]) {
        logger.exchange(`收到 ${events.length} 个通知事件。`);
        
        // 这里可以根据事件类型进行处理
        for (const event of events) {
            if (event.EventType === EventType.NewMail || event.EventType === EventType.Created) {
                
                // 对于每个通知，获取相关的项目ID
                if (event.ItemId) {
                    const uniqueId = event.ItemId.UniqueId;

                    // 检查是否最近已处理过
                    if (this.processedMessageIds.has(uniqueId)) {
                        logger.exchange(`跳过已处理的消息ID: ${uniqueId}`);
                        continue;
                    }

                    // 添加到已处理集合，并设置过期清理
                    this.processedMessageIds.add(uniqueId);
                    setTimeout(() => this.processedMessageIds.delete(uniqueId), 5 * 60 * 1000); // 5分钟后过期

                    logger.exchange('收到新邮件通知，正在处理...');
                    logger.exchange(`正在处理项目ID: ${JSON.stringify(event.ItemId)}`);
                    try {
                        // 创建ItemId对象
                        const itemId = new ItemId(uniqueId);
                        
                        // 首先尝试作为邮件处理
                        const propSet = new PropertySet(BasePropertySet.FirstClassProperties, [ItemSchema.Body]);
                        const email = await EmailMessage.Bind(this.service, itemId, propSet);
                        
                        // 将邮件转换为应用程序格式（包含正文）
                        const emailData: IEmail = this.parseEmailFromEWS(email, true);
                        
                        // 调试日志：只记录邮件主题信息
                        logger.exchange(`邮件详情 - ID: ${emailData.id}, 主题: ${emailData.subject}`);
                        
                        // 触发自动处理逻辑
                        await this.autoProcessNewEmail(emailData);
                    } catch (error: any) {
                        // 如果不是邮件，可能是日历事件
                        try {
                            await this.handleCalendarEvent(uniqueId);
                        } catch (calendarError: any) {
                            logger.error(`处理项目时出错（邮件/日历）: ${error.message || '未知错误'}`);
                        }
                    }
                }
            }
        }
    }
    
    // 处理日历事件
    private async handleCalendarEvent(itemId: string): Promise<void> {
        try {
            logger.exchange(`收到新日历事件通知，正在处理项目ID: ${itemId}`);
            
            // 创建ItemId对象
            const appointmentId = new ItemId(itemId);
            
            // 加载日历事件
            const propSet = new PropertySet(BasePropertySet.FirstClassProperties, [
                AppointmentSchema.Subject,
                AppointmentSchema.Start,
                AppointmentSchema.End,
                AppointmentSchema.Location,
                AppointmentSchema.Body,
                AppointmentSchema.RequiredAttendees,
                AppointmentSchema.Importance,
                AppointmentSchema.IsReminderSet
            ]);
            
            const appointment = await Appointment.Bind(this.service, appointmentId, propSet);
            
            let importance: 'high' | 'normal' | 'low' = 'normal';
            if (appointment.Importance === Importance.High) importance = 'high';
            else if (appointment.Importance === Importance.Low) importance = 'low';

            // 将日历事件转换为任务格式
            const taskData: Task = {
                id: uuidv4(),
                name: appointment.Subject,
                description: appointment.Body?.Text || '来自Exchange日历的事件',
                dueDate: appointment.End.ToUniversalTime().ToISOString(),
                startTime: appointment.Start.ToUniversalTime().ToISOString(),
                endTime: appointment.End.ToUniversalTime().ToISOString(),
                location: appointment.Location || '',
                completed: false,
                pushedToMSTodo: false,
                scheduleType: 'single',
                importance: importance,
                isReminderOn: appointment.IsReminderSet
            };
            
            logger.exchange(`日历事件详情 - 主题: ${taskData.name}, 开始时间: ${taskData.startTime}, 结束时间: ${taskData.endTime}`);
            
            // 检查用户是否有MS token
            if (!this.user?.MStoken) {
                logger.warn('用户未绑定MS账户，无法将日历事件推送到MS Todo');
                return;
            }
            
            // 使用createTodoItem将日历事件添加到MS Todo
            try {
                await createTodoItem(taskData, this.user.MStoken);
                logger.success(`已成功将日历事件添加到MS Todo: ${taskData.name}`);
            } catch (err: any) {
                // 如果是 401，则暂停该用户的 MS Graph 操作，直到前端刷新 token
                if (err.response?.status === 401) {
                    if (this.user) {
                        this.user.MStoken = '';
                        this.user.MSbinded = false;
                        try { await (await import('./dbService')).dbService.updateUser(this.user); } catch {}
                        logger.error(`MS Graph 401 detected; cleared MStoken and set MSbinded=false for user ${this.user.id}`);
                    }
                }
                throw err;
            }
            
        } catch (error: any) {
            logger.error(`处理日历事件时出错: ${error.message || '未知错误'}`);
        }
    }
    
    // 自动处理新邮件
 public async autoProcessNewEmail(email: IEmail) {
        try {
            logger.exchange(`开始自动处理邮件: ${email.subject}`);
            
            // 调试日志：只检查邮件正文是否存在，不输出内容
            if (!email.body) {
                logger.warn(`邮件正文为空: ${email.subject}`);
            }
           
            // 接入OpenAI API
            const apiResponse = await this.callDeepSeekAPI(email);
            
            // 触发后续处理逻辑
            await this.handleProcessedData(apiResponse, email);
            
            logger.success(`成功自动处理邮件: ${email.subject}`);   
        } catch (error: any) {
            logger.error(`自动处理邮件时出错: ${error.message || '未知错误'}`);
            // 错误处理和重试机制
            this.handleProcessingError(error, email);
        }
    }
    
    // 处理处理邮件时的错误，实现重试机制
    private handleProcessingError(error: any, email: IEmail, retryCount: number = 0) {
        const maxRetries = 3;
        
        if (retryCount < maxRetries) {
            const retryDelay = Math.pow(2, retryCount) * 5000; // 指数退避策略
            logger.exchange(`将在 ${retryDelay/1000} 秒后重试处理邮件: ${email.subject} (重试 ${retryCount + 1}/${maxRetries})`);
            
            setTimeout(() => {
                this.autoProcessNewEmail(email).catch(() => {
                    this.handleProcessingError(error, email, retryCount + 1);
                });
            }, retryDelay);
        } else {
            logger.error(`邮件处理失败，已达到最大重试次数: ${email.subject}`);
            // 将失败的邮件记录到日志，便于后续手动处理
            this.logFailedEmail(email, error);
        }
    }
    
    // 记录处理失败的邮件
    private logFailedEmail(email: IEmail, error: any) {
        try {
            const failureLog = {
                timestamp: new Date().toISOString(),
                emailId: email.id,
                subject: email.subject,
                from: email.from,
                receivedAt: email.receivedAt,
                error: error.message || JSON.stringify(error),
                errorStack: error.stack
            };
            
            logger.error('记录失败邮件:', JSON.stringify(failureLog, null, 2));
            
            // 这里可以扩展为将失败记录存储到数据库或文件系统
        } catch (logError) {
            logger.error('记录失败邮件时出错:', logError);
        }
    }
    
    // 接入OpenAI API
    private async callDeepSeekAPI(email: IEmail): Promise<any> {
        // 这里应该是调用DeepSeek API兼容Openai API
        if (!this.llmApi) {
            throw new Error('LLM API 客户端未初始化');
        }
        
        return this.llmApi.processEmail(email);
    }
    

    // 触发后续处理逻辑
    private async handleProcessedData(processedData: any, email: IEmail): Promise<void> {
        if (!processedData.tool_calls || processedData.tool_calls.length === 0) {
            logger.exchange(`未触发任何工具调用`);
            return;
        }

        for (const toolCall of processedData.tool_calls) {
            const functionName = (toolCall as any).function.name;
            const args = JSON.parse((toolCall as any).function.arguments);
            
            logger.exchange(`处理工具调用: ${functionName}, 参数: ${JSON.stringify(args)}`);

            if (functionName === 'add_schedule') {
                await this.handleAddScheduleTool(args, email);
            } else if (functionName === 'log_info') {
                await this.handleLogInfoTool(args, email);
            } else {
                logger.warn(`未知的工具调用: ${functionName}`);
            }
        }
        
        // 分析邮件重要性
        // if (this.llmApi) {
        //     const importance = await this.llmApi.analyzeEmailImportance(email);
        //     logger.exchange(`邮件重要性: ${importance.importance}，理由: ${importance.reason}`);
        // }
    }

    private async handleAddScheduleTool(args: any, email: IEmail): Promise<void> {
        if (!this.user) {
            logger.error('无法创建任务：用户未初始化');
            return;
        }

        // 确保 args 存在
        const safeArgs = args || {};

        // 如果没有提供任务名称，使用邮件主题作为默认名称
        if (!safeArgs.name) {
            logger.warn(`LLM 未提供任务名称，使用邮件主题作为默认名称: ${email.subject}`);
            safeArgs.name = email.subject || '未命名任务';
        }

        // 清理邮件正文内容
        const cleanedEmailBody = this.cleanHtmlContent(email.body || '');
        const description = safeArgs.description ? `${safeArgs.description}\n\n来自邮件: ${email.subject}\n\n${cleanedEmailBody}` : `来自邮件: ${email.subject}\n\n${cleanedEmailBody}`;

        const toolArgs = {
            ...safeArgs,
            description
        };

        // 自动化（LLM）处理邮件时，日程请求入队，不直接入库
        try {
            const dbService = (await import('./dbService')).dbService;
            const rawRequest = JSON.stringify({ args: toolArgs, email });
            await dbService.addScheduleToQueue(this.user.id, rawRequest);
            logger.success(`已将日程请求加入队列，待用户确认: ${toolArgs.name}`);
        } catch (err : any) {
            logger.error(`日程队列入库失败: ${err.message || '未知错误'}`);
        }
    }

    private async handleLogInfoTool(args: any, email: IEmail): Promise<void> {
        logger.exchange(`信息通知已记录: ${args.summary} (重要性: ${args.importance})`);
    }


    

    // 健康检查定时
    
    // 启动健康检查
    private startHealthCheck() {
        // 清除现有的健康检查
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        // 每30分钟执行一次健康检查
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck().catch(err => {
                logger.error('健康检查失败:', err.message || '未知错误');
                // 健康检查失败时尝试重启连接
                this.restartConnection();
            });
        }, 30 * 60 * 1000);
        
        logger.exchange('推送通知健康检查已启动。');
    }
    
    // 执行健康检查
    private async performHealthCheck() {
        try {
            logger.exchange('执行推送通知健康检查...');
            
            // 检查连接状态
            if (this.streamingConnection && this.streamingConnection.IsOpen) {
                logger.exchange('推送通知连接状态正常。');
                return true;
            } else {
                throw new Error('推送通知连接已关闭');
            }
        } catch (error) {
            logger.error('健康检查检测到异常:', error || '未知错误');
            throw error;
        }
    }
    
    // 重启推送通知连接
    private async restartConnection() {
        logger.exchange('正在重启推送通知连接...');
        try {
            // 停止当前连接
            await this.stopPushNotifications();
            // 短暂延迟后重新启动
            setTimeout(() => {
                this.startPushNotifications().catch(err => {
                    logger.error('重启推送通知连接失败:', err.message || '未知错误');
                });
            }, 2000);
        } catch (error) {
            logger.error('重启连接过程中出错:', error|| '未知错误');
        }
    }

    /**
     * Autodiscover 重定向验证回调
     */
    private redirectionUrlValidationCallback(redirectionUrl: string): boolean {
        logger.data(`[EWS-REDIRECT] Autodiscover 尝试重定向到: ${redirectionUrl}`);
        // 简单的验证：允许所有 https 重定向。在生产环境中应更严格。
        const isValid = new Uri(redirectionUrl).Scheme.toLowerCase() === 'https';
        logger.data(`[EWS-REDIRECT] 重定向URL验证结果: ${isValid ? '有效' : '无效'}`);
        return isValid;
    }

    /**
     * 获取未读邮件
     * @param top - 要获取的邮件数量
     * @returns 邮件数组
     */
    async getUnreadEmails(top: number = 10): Promise<IEmail[]> {
        await this.ensureAutodiscover();
        logger.exchange(`开始获取 ${top} 封未读邮件...`);

        // 创建过滤器，仅获取未读邮件
        const searchFilter = new SearchFilter.IsEqualTo(EmailMessageSchema.IsRead, false);
    
        return this.findEmails(top, searchFilter);
    }

    async findEmails(top: number = 10, searchFilter?: SearchFilter): Promise<IEmail[]> {
        // 创建视图，限制结果数量
        const view = new ItemView(top);
        // 定义要加载的属性（不包含正文，因为Body不能在FindItem请求中使用）
        view.PropertySet = new PropertySet(BasePropertySet.FirstClassProperties, [
            ItemSchema.Subject,
            ItemSchema.DateTimeReceived,
            EmailMessageSchema.From,
            EmailMessageSchema.IsRead
        ]);
        try {
            const findResults = searchFilter 
                ? await this.service.FindItems(WellKnownFolderName.Inbox, searchFilter, view)
                : await this.service.FindItems(WellKnownFolderName.Inbox, view);
            logger.success(`成功获取到 ${findResults.TotalCount} 封邮件。`);
            
            if (findResults.Items.length === 0) {
                return [];
            }

            // 将 EWS item 转换为我们的 IEmail 格式（不包含正文，将在需要时单独获取）
            const emails = findResults.Items.map(item => this.parseEmailFromEWS(item as EmailMessage, false));
            
            // 调试日志：只记录邮件主题信息
            emails.forEach((email, index) => {
                logger.exchange(`邮件 ${index + 1}: ID=${email.id}, 主题="${email.subject}"`);
            });
            
            return emails;
        } catch (err) {
            logger.error('获取邮件失败: ' + (err instanceof Error ? err.message : err));
            // 打印更详细的错误信息
            if (err && typeof err === 'object') {
                logger.data('详细错误: ' + JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
            }
            throw err;
        }
    }

    /**
     * 根据 ID 获取单个邮件详情
     * @param itemId - 邮件 ID
     * @returns 邮件详情
     */
    async getEmailById(itemId: string): Promise<IEmail> {
        await this.ensureAutodiscover();
        logger.exchange(`正在获取 ID 为 ${itemId} 的邮件...`);
        
        const propSet = new PropertySet(BasePropertySet.FirstClassProperties, [ItemSchema.Body]);
        const email = await EmailMessage.Bind(this.service, new ItemId(itemId), propSet);
        
        logger.success(`成功获取邮件: ${email.Subject}`);
        return this.parseEmailFromEWS(email, true);
    }

    /**
     * 清理HTML内容，移除可能导致XML验证失败的标签
     * @param htmlContent - HTML内容
     * @returns 清理后的纯文本内容
     */
    private cleanHtmlContent(htmlContent: string): string {
        if (!htmlContent) return '';
        
        try {
            // 移除HTML标签但保留文本内容
            let cleaned = htmlContent
                // 移除script, style, head标签及其内容
                .replace(/<script\b[\s\S]*?<\/script>/gi, '')
                .replace(/<style\b[\s\S]*?<\/style>/gi, '')
                .replace(/<head\b[\s\S]*?<\/head>/gi, '')
                // 移除所有其他HTML标签
                .replace(/<[^>]+>/g, ' ')
                // 替换常见HTML实体
                .replace(/&nbsp;/g, ' ')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .trim();
            
            // 移除多余的空白字符
            cleaned = cleaned.replace(/\s+/g, ' ');
            
            logger.exchange(`HTML内容清理完成，原始长度: ${htmlContent.length}, 清理后长度: ${cleaned.length}`);
            return cleaned;
        } catch (error) {
            logger.warn(`清理HTML内容时出错:`, error);
            // 如果清理失败，返回原始内容的简单版本
            return htmlContent.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        }
    }

    /**
     * 创建日历事件
     * @param eventData - 事件数据
     * @returns 创建的事件
     */
    async createEvent(eventData: IEvent): Promise<Appointment> {
        await this.ensureAutodiscover();
        logger.exchange(`正在创建日历事件: ${eventData.subject}`);

        try {
            const appointment = new Appointment(this.service);
            appointment.Subject = eventData.subject;
            
            // 安全地设置正文内容，先清理HTML
            if (eventData.body) {
                const cleanedBody = this.cleanHtmlContent(eventData.body);
                appointment.Body = new MessageBody(cleanedBody);
                logger.exchange(`事件正文已清理，长度: ${cleanedBody.length}`);
            } else {
                appointment.Body = new MessageBody('');
            }
            
            appointment.Start = new DateTime(eventData.start);
            appointment.End = new DateTime(eventData.end);
            appointment.Location = eventData.location || '';

            // 设置重要性
            if (eventData.importance) {
                switch (eventData.importance) {
                    case 'high':
                        appointment.Importance = Importance.High;
                        break;
                    case 'low':
                        appointment.Importance = Importance.Low;
                        break;
                    default:
                        appointment.Importance = Importance.Normal;
                }
            }

            // 设置提醒
            if (eventData.isReminderOn !== undefined) {
                appointment.IsReminderSet = eventData.isReminderOn;
            }

            // 安全地添加与会者
            if (eventData.attendees && eventData.attendees.length > 0) {
                eventData.attendees.forEach(email => {
                    try {
                        appointment.RequiredAttendees.Add(email);
                    } catch (attendeeError) {
                        logger.warn(`添加与会者 ${email} 失败:`, attendeeError);
                    }
                });
            }

            await appointment.Save(SendInvitationsMode.SendToAllAndSaveCopy);
            logger.success(`日历事件 "${eventData.subject}" 创建成功。`);
            return appointment;
        } catch (error) {
            logger.error(`创建日历事件失败:`, error);
            throw error;
        }
    }

    /**
     * 获取指定时间范围内的日历事件
     * @param startDate - 开始日期
     * @param endDate - 结束日期
     * @returns 事件数组
     */
    async getEvents(startDate: string, endDate: string): Promise<IEvent[]> {
        await this.ensureAutodiscover();
        logger.exchange(`正在获取从 ${startDate} 到 ${endDate} 的日历事件...`);

        const start = new DateTime(startDate);
        const end = new DateTime(endDate);
        const calendarView = new CalendarView(start, end, 100); // 最多获取100个事件

        calendarView.PropertySet = new PropertySet(BasePropertySet.IdOnly, [
            AppointmentSchema.Subject,
            AppointmentSchema.Start,
            AppointmentSchema.End,
            AppointmentSchema.Location,
            AppointmentSchema.Importance,
            AppointmentSchema.IsReminderSet
        ]);

        try {
            const findResults = await this.service.FindAppointments(WellKnownFolderName.Calendar, calendarView);
            logger.success(`成功获取到 ${findResults.TotalCount} 个日历事件。`);
            
            return findResults.Items.map(item => this.parseEventFromEWS(item));
        } catch (err) {
            logger.error('获取日历事件失败: ' + (err instanceof Error ? err.message : err));
            // 打印更详细的错误信息
            if (err && typeof err === 'object') {
                logger.data('详细错误: ' + JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
            }
            throw err;
        }
    }

    /**
     * 将 EWS EmailMessage 对象解析为 IEmail 格式
     */
    private parseEmailFromEWS(email: EmailMessage, includeBody: boolean = false): IEmail {
        const from = email.From;
        const bodyText = includeBody ? this.cleanHtmlContent(email.Body?.Text || '') : undefined;

        return {
            id: email.Id.UniqueId,
            subject: email.Subject,
            from: from ? { name: from.Name, address: from.Address } : undefined,
            receivedAt: email.DateTimeReceived.MomentDate.toISOString(),
            isRead: email.IsRead,
            body: bodyText,
            hasAttachments: email.HasAttachments,
            attachments: email.Attachments,
        };
    }

    /**
     * 将 EWS Appointment 对象解析为 IEvent 格式
     */
    private parseEventFromEWS(appointment: Appointment): IEvent {
        let importance: 'high' | 'normal' | 'low' = 'normal';
        try {
            if (appointment.Importance === Importance.High) importance = 'high';
            else if (appointment.Importance === Importance.Low) importance = 'low';
        } catch (e) {
            // Property might not be loaded
        }

        let isReminderOn = false;
        try {
            isReminderOn = appointment.IsReminderSet;
        } catch (e) {
            // Property might not be loaded
        }

        return {
            id: appointment.Id.UniqueId,
            subject: appointment.Subject,
            start: appointment.Start.MomentDate.toISOString(),
            end: appointment.End.MomentDate.toISOString(),
            location: appointment.Location,
            importance: importance,
            isReminderOn: isReminderOn
        };
    }
}
