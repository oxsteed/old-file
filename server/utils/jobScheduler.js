/**
 * jobScheduler.js
 * Simple cron-based job scheduler for background tasks
 * Integrates with node-cron to execute jobs on schedule
 */

const cron = require('node-cron');
const logger = require('./logger');

class JobScheduler {
  constructor() {
    this.jobs = new Map();
    this.tasks = new Map();
  }

  /**
   * Register a job for scheduling
   * Job must have: id, description, cronExpression, handler()
   */
  registerJob(job) {
    if (!job.id || !job.cronExpression || !job.handler) {
      throw new Error('Job must have id, cronExpression, and handler function');
    }

    this.jobs.set(job.id, job);
    logger.info('Job registered', {
      job_id: job.id,
      description: job.description,
      cron: job.cronExpression,
    });
  }

  /**
   * Start all registered jobs
   */
  startAll() {
    for (const [jobId, job] of this.jobs) {
      try {
        const task = cron.schedule(job.cronExpression, async () => {
          logger.debug('Job started', { job_id: jobId });
          try {
            const result = await job.handler();
            logger.info('Job completed', {
              job_id: jobId,
              result: result || 'success',
            });
          } catch (error) {
            logger.error('Job failed', {
              job_id: jobId,
              error: error.message,
              stack: error.stack,
            });
          }
        });

        this.tasks.set(jobId, task);
        logger.info('Job started', {
          job_id: jobId,
          next_run: this.getNextRun(job.cronExpression),
        });
      } catch (error) {
        logger.error('Failed to start job', {
          job_id: jobId,
          error: error.message,
        });
      }
    }
  }

  /**
   * Stop a specific job
   */
  stopJob(jobId) {
    const task = this.tasks.get(jobId);
    if (task) {
      task.stop();
      this.tasks.delete(jobId);
      logger.info('Job stopped', { job_id: jobId });
    }
  }

  /**
   * Stop all jobs
   */
  stopAll() {
    for (const [jobId, task] of this.tasks) {
      task.stop();
    }
    this.tasks.clear();
    logger.info('All jobs stopped');
  }

  /**
   * Get next run time for a cron expression (approximate)
   */
  getNextRun(cronExpression) {
    // Simple approximation - in production use cron-parser for exact time
    return 'calculated at runtime';
  }

  /**
   * Get job status
   */
  getStatus(jobId) {
    const job = this.jobs.get(jobId);
    const task = this.tasks.get(jobId);

    return {
      id: jobId,
      description: job?.description,
      cron: job?.cronExpression,
      running: !!task,
    };
  }

  /**
   * Get all job statuses
   */
  getAllStatus() {
    return Array.from(this.jobs.keys()).map(jobId => this.getStatus(jobId));
  }
}

module.exports = new JobScheduler();
