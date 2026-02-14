/**
 * Type definitions for FiatLux
 */

export interface Schedule {
  id: string;
  type: 'current' | 'future';
  date: string;
  dateEnd?: string;
  queues: QueueInfo[];
  rawText: string;
  publishedAt: string;
  messageId: number;
  channelId: string;
  archived: boolean;
}

export interface QueueInfo {
  queueNumber: number;
  timeSlots: TimeSlot[];
  description?: string;
}

export interface TimeSlot {
  start: string;
  end: string;
}

export interface ScheduleData {
  schedules: Schedule[];
  lastUpdated: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  uptime: number;
  telegramConnected: boolean;
  lastMessageCheck?: string;
  schedulesCount: number;
}
