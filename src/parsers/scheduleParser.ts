import { Api } from 'telegram/tl';
import { Schedule, QueueInfo, TimeSlot } from '../types';
import { logger } from '../utils/logger';

/**
 * Helper to get local date string in YYYY-MM-DD format
 */
function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parser for power outage schedule messages from Cherkasyoblenergo channel
 */

export class ScheduleParser {
  private static readonly KEYWORDS = [
    'графік',
    'графік відключень',
    'черга',
    'група',
    'відключення',
    'вимкнення',
    'знеструмлення',
  ];

  /**
   * Check if message contains schedule information
   */
  static isScheduleMessage(text: string): boolean {
    const lowerText = text.toLowerCase();
    return this.KEYWORDS.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Determine if schedule is current or future based on date
   */
  static determineScheduleType(_text: string, date: Date): 'current' | 'future' {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const scheduleDate = new Date(date);
    scheduleDate.setHours(0, 0, 0, 0);

    // Current - for today
    if (scheduleDate.getTime() === today.getTime()) {
      return 'current';
    }

    // Future - for tomorrow
    if (scheduleDate.getTime() === tomorrow.getTime()) {
      return 'future';
    }

    // Default to current for backward compatibility
    return 'current';
  }

  /**
   * Check if schedule date is relevant (today or tomorrow only)
   */
  static isRelevantDate(date: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

    const scheduleDate = new Date(date);
    scheduleDate.setHours(0, 0, 0, 0);

    // Only today and tomorrow are relevant
    return scheduleDate >= today && scheduleDate < dayAfterTomorrow;
  }

  /**
   * Extract date from message text
   */
  static extractDate(text: string): string | null {
    const lowerText = text.toLowerCase();

    // Ukrainian months
    const months: Record<string, number> = {
      'січня': 1, 'січень': 1,
      'лютого': 2, 'лютий': 2,
      'березня': 3, 'березень': 3,
      'квітня': 4, 'квітень': 4,
      'травня': 5, 'травень': 5,
      'червня': 6, 'червень': 6,
      'липня': 7, 'липень': 7,
      'серпня': 8, 'серпень': 8,
      'вересня': 9, 'вересень': 9,
      'жовтня': 10, 'жовтень': 10,
      'листопада': 11, 'листопад': 11,
      'грудня': 12, 'грудень': 12,
    };

    // Pattern: "15 лютого", "15 лютий"
    for (const [monthName, monthNum] of Object.entries(months)) {
      const pattern = new RegExp(`(\\d{1,2})\\s+${monthName}`, 'i');
      const match = lowerText.match(pattern);
      if (match) {
        const day = match[1].padStart(2, '0');
        const month = monthNum.toString().padStart(2, '0');
        const year = new Date().getFullYear();
        return `${year}-${month}-${day}`;
      }
    }

    // Pattern: DD.MM.YYYY or DD.MM
    const datePattern = /(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?/g;
    const matches = [...text.matchAll(datePattern)];

    if (matches.length > 0) {
      const match = matches[0];
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3] || new Date().getFullYear().toString();
      return `${year}-${month}-${day}`;
    }

    // Try to find day of week and relative dates
    const today = new Date();

    if (lowerText.includes('сьогодні')) {
      return getLocalDateString(today);
    }

    if (lowerText.includes('завтра')) {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return getLocalDateString(tomorrow);
    }

    // Return today's date as fallback
    return getLocalDateString(today);
  }

  /**
   * Extract time slots from a single line with comma-separated times
   */
  static extractTimeSlotsFromLine(text: string): TimeSlot[] {
    const slots: TimeSlot[] = [];

    // Pattern: "08:00-12:00", "8:00 - 12:00", "08:00 – 12:00"
    // Supports various dash types: -, –, —
    const timePattern = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g;
    const matches = [...text.matchAll(timePattern)];

    for (const match of matches) {
      const startHour = match[1].padStart(2, '0');
      const startMin = match[2];
      const endHour = match[3].padStart(2, '0');
      const endMin = match[4];

      slots.push({
        start: `${startHour}:${startMin}`,
        end: `${endHour}:${endMin}`,
      });
    }

    return slots;
  }

  /**
   * Extract queue info with sub-queues from text
   */
  static extractQueuesWithSubQueues(text: string): QueueInfo[] {
    const queuesMap = new Map<string, TimeSlot[]>();

    // Pattern: "1.1: 00:00 – 02:00, 07:00 – 09:30"
    // Matches queue number with optional sub-queue
    const queuePattern = /(\d+)\.(\d+):\s*([^\n]+)/g;
    const matches = [...text.matchAll(queuePattern)];

    for (const match of matches) {
      const mainQueue = parseInt(match[1], 10);
      const subQueue = parseInt(match[2], 10);
      const queueKey = `${mainQueue}.${subQueue}`;
      const timeSlotsText = match[3];

      // Extract all time slots from this line
      const timeSlots = this.extractTimeSlotsFromLine(timeSlotsText);

      if (timeSlots.length > 0) {
        queuesMap.set(queueKey, timeSlots);
      }
    }

    // Convert map to QueueInfo array
    const queues: QueueInfo[] = [];
    for (const [queueKey, timeSlots] of queuesMap) {
      const [main, sub] = queueKey.split('.').map(n => parseInt(n, 10));
      queues.push({
        queueNumber: main + (sub / 10), // 1.1 -> 1.1, 1.2 -> 1.2
        timeSlots,
        description: `Черга ${queueKey}`,
      });
    }

    return queues.sort((a, b) => a.queueNumber - b.queueNumber);
  }

  /**
   * Extract queue numbers from text (legacy support)
   */
  static extractQueues(text: string): number[] {
    const queues = new Set<number>();

    // Pattern for sub-queues: "1.1", "2.2", etc.
    const subQueuePattern = /(\d+)\.\d+:/g;
    const subMatches = [...text.matchAll(subQueuePattern)];

    for (const match of subMatches) {
      const queueNum = parseInt(match[1], 10);
      if (queueNum >= 1 && queueNum <= 6) {
        queues.add(queueNum);
      }
    }

    // Pattern: "черга 1", "1 черга", "група 2", "2 група", etc.
    const queuePattern = /(?:черг[аи]|груп[аи])\s*[№#]?\s*(\d+)|(\d+)\s*(?:черг[аи]|груп[аи])/gi;
    const matches = [...text.matchAll(queuePattern)];

    for (const match of matches) {
      const queueNum = parseInt(match[1] || match[2], 10);
      if (queueNum >= 1 && queueNum <= 6) {
        queues.add(queueNum);
      }
    }

    // Pattern: "1-а, 2-а, 3-я черга"
    const listPattern = /(\d+)-[аяі]/g;
    const listMatches = [...text.matchAll(listPattern)];

    for (const match of listMatches) {
      const queueNum = parseInt(match[1], 10);
      if (queueNum >= 1 && queueNum <= 6) {
        queues.add(queueNum);
      }
    }

    return Array.from(queues).sort((a, b) => a - b);
  }

  /**
   * Extract time slots from text (legacy support)
   */
  static extractTimeSlots(text: string): TimeSlot[] {
    const slots: TimeSlot[] = [];

    // Pattern: "08:00-12:00", "8:00 - 12:00", "з 08:00 до 12:00"
    const timePattern = /(?:з\s+)?(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})|(?:з\s+)?(\d{1,2}):(\d{2})\s+до\s+(\d{1,2}):(\d{2})/gi;
    const matches = [...text.matchAll(timePattern)];

    for (const match of matches) {
      let startHour: string, startMin: string, endHour: string, endMin: string;

      if (match[1]) {
        startHour = match[1].padStart(2, '0');
        startMin = match[2];
        endHour = match[3].padStart(2, '0');
        endMin = match[4];
      } else {
        startHour = match[5].padStart(2, '0');
        startMin = match[6];
        endHour = match[7].padStart(2, '0');
        endMin = match[8];
      }

      slots.push({
        start: `${startHour}:${startMin}`,
        end: `${endHour}:${endMin}`,
      });
    }

    return slots;
  }

  /**
   * Parse a Telegram message into a Schedule object
   */
  static parseMessage(message: Api.Message): Schedule | null {
    const text = message.message;

    if (!text || !this.isScheduleMessage(text)) {
      return null;
    }

    try {
      const date = this.extractDate(text);
      if (!date) {
        logger.warn(`Could not extract date from message ID ${message.id}. Text starts with: "${text.substring(0, 50)}..."`);
        return null;
      }

      // Try to extract sub-queues first (1.1, 1.2, etc.)
      let queues = this.extractQueuesWithSubQueues(text);

      // Fallback to old format if no sub-queues found
      if (queues.length === 0) {
        const queueNumbers = this.extractQueues(text);
        const timeSlots = this.extractTimeSlots(text);

        queues = queueNumbers.map(queueNum => ({
          queueNumber: queueNum,
          timeSlots: timeSlots,
          description: `Черга ${queueNum}`,
        }));
      }

      // CRITICAL: Only accept messages with actual schedules (queues AND time slots)
      if (queues.length === 0) {
        logger.debug(`Skipping message ID ${message.id} - no queues found in text`);
        return null;
      }

      // Verify that at least one queue has time slots
      const hasTimeSlots = queues.some(q => q.timeSlots && q.timeSlots.length > 0);
      if (!hasTimeSlots) {
        logger.debug(`Skipping message ID ${message.id} - no time slots found in any of the ${queues.length} queues`);
        return null;
      }

      const messageDate = new Date(message.date * 1000);
      const scheduleDate = new Date(date);

      // Filter out schedules that are not for today or tomorrow
      if (!this.isRelevantDate(scheduleDate)) {
        logger.debug(`Skipping schedule for ${date} - not today or tomorrow`);
        return null;
      }

      const type = this.determineScheduleType(text, scheduleDate);

      const schedule: Schedule = {
        id: `${message.id}-${date}`,
        type,
        date,
        queues,
        rawText: text,
        publishedAt: messageDate.toISOString(),
        messageId: message.id,
        channelId: message.chatId?.toString() || '',
        archived: false,
      };

      logger.info(`Parsed schedule: ${type} for ${date} with ${queues.length} queues`);
      return schedule;
    } catch (error) {
      logger.error('Error parsing message:', error);
      return null;
    }
  }

  /**
   * Parse multiple messages
   */
  static parseMessages(messages: Api.Message[]): Schedule[] {
    const schedules: Schedule[] = [];

    for (const message of messages) {
      const schedule = this.parseMessage(message);
      if (schedule) {
        schedules.push(schedule);
      }
    }

    return schedules;
  }
}
