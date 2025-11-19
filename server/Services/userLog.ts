import { dbService } from './dbService';
import { broadcastUserLog } from './websocket';

export interface UserLogEvent {
  id: string;
  time: string;
  type: string;
  message: string;
  payload?: any;
}

export async function logUserEvent(userId: string, type: string, message: string, payload?: any): Promise<UserLogEvent> {
  const saved = await dbService.addUserLog(userId, type, message, payload);
  broadcastUserLog(userId, saved);
  return saved;
}
