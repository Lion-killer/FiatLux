import { Schedule } from '../types';
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
 * In-memory data manager for storing and retrieving schedules
 * Data is kept in RAM only - no file persistence
 */
export class DataManager {
  private schedules: Schedule[] = [];

  constructor() {
    logger.info('Initialized in-memory data storage');
  }

  /**
   * Initialize (no-op for in-memory storage)
   */
  async initialize(): Promise<void> {
    logger.info('Data storage ready (in-memory)');
  }

  /**
   * Add or update a schedule (in-memory)
   */
  async saveSchedule(schedule: Schedule): Promise<boolean> {
    // Check if schedule already exists
    const existingIndex = this.schedules.findIndex(s => s.id === schedule.id);
    
    if (existingIndex >= 0) {
      // Update existing schedule
      this.schedules[existingIndex] = schedule;
      logger.info(`Updated schedule: ${schedule.id}`);
      return false;
    } else {
      // Add new schedule
      this.schedules.push(schedule);
      logger.info(`Added new schedule: ${schedule.id}`);
      
      // Archive older schedules
      this.archiveOlderSchedules(schedule);
      return true;
    }
  }

  /**
   * Archive schedules based on date and relevance
   */
  private archiveOlderSchedules(newSchedule: Schedule): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const newDate = new Date(newSchedule.date);
    newDate.setHours(0, 0, 0, 0);
    
    for (const schedule of this.schedules) {
      if (schedule.id === newSchedule.id) continue;
      if (schedule.archived) continue;
      
      const scheduleDate = new Date(schedule.date);
      scheduleDate.setHours(0, 0, 0, 0);
      
      // Archive schedules from the past
      if (scheduleDate < today) {
        schedule.archived = true;
        logger.info(`Archived past schedule: ${schedule.id} (${schedule.date})`);
        continue;
      }
      
      // Archive older schedules for the same date
      if (schedule.date === newSchedule.date) {
        const schedulePublished = new Date(schedule.publishedAt);
        const newPublished = new Date(newSchedule.publishedAt);
        
        if (schedulePublished < newPublished) {
          schedule.archived = true;
          logger.info(`Archived older schedule for same date: ${schedule.id}`);
        }
      }
    }
  }

  /**
   * Check if schedule is for today or tomorrow
   */
  private isRelevantSchedule(schedule: Schedule): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    
    const scheduleDate = new Date(schedule.date);
    scheduleDate.setHours(0, 0, 0, 0);
    
    return scheduleDate >= today && scheduleDate < dayAfterTomorrow;
  }

  /**
   * Get current schedule (for today)
   */
  async getCurrentSchedule(): Promise<Schedule | null> {
    const today = new Date();
    const todayStr = getLocalDateString(today);
    
    const current = this.schedules
      .filter(s => {
        return s.date === todayStr && 
               !s.archived && 
               this.isRelevantSchedule(s);
      })
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    
    return current[0] || null;
  }

  /**
   * Get future schedule (for tomorrow)
   */
  async getFutureSchedule(): Promise<Schedule | null> {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = getLocalDateString(tomorrow);
    
    const future = this.schedules
      .filter(s => {
        return s.date === tomorrowStr && 
               !s.archived && 
               this.isRelevantSchedule(s);
      })
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    
    return future[0] || null;
  }

  /**
   * Get all active schedules
   */
  async getAllSchedules(): Promise<{ current: Schedule | null; future: Schedule | null }> {
    const [current, future] = await Promise.all([
      this.getCurrentSchedule(),
      this.getFutureSchedule(),
    ]);
    
    return { current, future };
  }

  /**
   * Get schedule history (only today and tomorrow)
   */
  async getHistory(limit: number = 10): Promise<Schedule[]> {
    return this.schedules
      .filter(s => this.isRelevantSchedule(s))
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, limit);
  }

  /**
   * Get total count of schedules
   */
  async getCount(): Promise<number> {
    return this.schedules.length;
  }

  /**
   * Clear all archived schedules
   */
  cleanupOldSchedules(): number {
    const initialCount = this.schedules.length;
    this.schedules = this.schedules.filter(s => !s.archived);
    const removedCount = initialCount - this.schedules.length;
    
    if (removedCount > 0) {
      logger.info(`Cleaned up ${removedCount} archived schedules`);
    }
    
    return removedCount;
  }

  /**
   * Reset all data (for testing)
   */
  async reset(): Promise<void> {
    this.schedules = [];
    logger.info('Reset all in-memory schedules');
  }
}
