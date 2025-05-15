/**
 * Represents the result of a completed job
 * @template T Type of the job result
 */
type JobResult<T> = {
    result: T;          // The value returned by the job function
    queueTime: number;  // Time in milliseconds the job waited in queue
    executionTime: number; // Time in milliseconds the job took to execute
};

/**
 * Configuration options for the JobQueue
 */
type JobQueueOptions = {
    concurrencyLimit?: number; // Max simultaneous jobs (default: 1000)
    rateLimit?: number;        // Max jobs per minute (default: unlimited)
    timeoutLimit?: number;     // Max seconds per job (default: 1200s/20min)
};

/**
 * Internal representation of a job in the queue
 * @template T Type of the job result
 */
type Job<T> = {
    fn: (...args: any[]) => Promise<T>; // The async function to execute
    args: any[];                        // Arguments to pass to the function
    resolve: (value: JobResult<T>) => void; // Resolves the job's promise
    reject: (reason?: any) => void;      // Rejects the job's promise
    enqueueTime: number;                 // Timestamp when job was enqueued
};

/**
 * A robust job queue with concurrency control, rate limiting, and timeout handling
 */
export class JobQueue {
    // Internal queue of pending jobs
    private queue: Job<any>[] = [];
    
    // Set of currently executing job promises
    private activeJobs = new Set<Promise<any>>();
    
    // Flag indicating if the queue has been disposed
    private disposed = false;
    
    // Configuration values (readonly after construction)
    private readonly concurrencyLimit: number;
    private readonly rateLimit: number | null;
    private readonly timeoutLimit: number;
    
    // Rate limiting state
    private lastTokenRefresh: number = 0; // Last time tokens were refreshed
    private tokens: number = 0;          // Available execution tokens
    
    // Flag to prevent concurrent queue processing
    private processing = false;

    /**
     * Creates a new JobQueue with optional configuration
     * @param options Configuration options
     */
    constructor(options: JobQueueOptions = {}) {
        this.concurrencyLimit = options.concurrencyLimit ?? 1000;
        this.rateLimit = options.rateLimit ?? null;
        this.timeoutLimit = options.timeoutLimit ?? 1200;
        
        // Initialize rate limiting if enabled
        if (this.rateLimit !== null) {
            this.tokens = this.rateLimit;
            this.lastTokenRefresh = Date.now();
        }
    }

    /**
     * Schedules a new job for execution
     * @template T Return type of the job function
     * @param fn Async function to execute
     * @param args Arguments to pass to the function
     * @returns Promise that resolves with job result or rejects with error
     */
    schedule<T>(fn: (...args: any[]) => Promise<T>, ...args: any[]): Promise<JobResult<T>> {
        if (this.disposed) {
            return Promise.reject(new Error('JobQueue has been disposed'));
        }

        return new Promise<JobResult<T>>((resolve, reject) => {
            // Create job object and add to queue
            const job: Job<T> = {
                fn,
                args,
                resolve,
                reject,
                enqueueTime: Date.now()
            };

            this.queue.push(job);
            this.processQueue().catch(error => {
                console.error('Error processing queue:', error);
            });
        });
    }

    /**
     * Gets the current number of queued jobs
     * @returns Number of jobs waiting in queue
     */
    size(): number {
        return this.queue.length;
    }

    /**
     * Gets the current number of actively executing jobs
     * @returns Number of jobs currently running
     */
    active(): number {
        return this.activeJobs.size;
    }

    /**
     * Disposes the queue, rejecting all pending jobs
     */
    dispose(): void {
        this.disposed = true;
        // Reject all queued jobs
        this.queue.forEach(job => {
            job.reject(new Error('JobQueue has been disposed'));
        });
        this.queue = [];
        this.activeJobs.clear();
    }

    /**
     * Processes jobs from the queue while respecting limits
     * @private
     */
    private async processQueue(): Promise<void> {
        // Don't process if already processing, disposed, or empty
        if (this.processing || this.disposed || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        try {
            // Process jobs while we have capacity
            while (this.queue.length > 0 && !this.disposed) {
                // Handle rate limiting if enabled
                if (this.rateLimit !== null) {
                    this.refreshTokens();
                    if (this.tokens <= 0) {
                        // Wait until next token refresh
                        const now = Date.now();
                        const nextRefresh = this.lastTokenRefresh + 60000;
                        await new Promise(resolve => setTimeout(resolve, nextRefresh - now));
                        continue;
                    }
                }

                // Stop if we've reached concurrency limit
                if (this.activeJobs.size >= this.concurrencyLimit) {
                    break;
                }

                // Take next job from queue
                const job = this.queue.shift()!;
                if (this.rateLimit !== null) {
                    this.tokens--; // Consume a token
                }

                // Execute the job and track it
                const jobPromise = this.executeJob(job);
                this.activeJobs.add(jobPromise);
                
                // Clean up when job completes
                jobPromise.finally(() => {
                    this.activeJobs.delete(jobPromise);
                    // Reprocess queue when job finishes
                    this.processQueue().catch(error => {
                        console.error('Error reprocessing queue:', error);
                    });
                });
            }
        } finally {
            this.processing = false;
        }
    }

    /**
     * Refreshes rate limiting tokens if needed
     * @private
     */
    private refreshTokens(): void {
        const now = Date.now();
        const elapsed = now - this.lastTokenRefresh;
        
        // Reset tokens if a minute has passed
        if (elapsed >= 60000) {
            this.tokens = this.rateLimit!;
            this.lastTokenRefresh = now;
        }
    }

    /**
     * Executes a job with timeout handling
     * @template T Job result type
     * @param job The job to execute
     * @private
     */
    private async executeJob<T>(job: Job<T>): Promise<void> {
        const { fn, args, resolve, reject, enqueueTime } = job;
        const queueTime = Date.now() - enqueueTime;
        let executionTime = 0;

        try {
            // Setup timeout rejection
            const timeoutPromise = new Promise<T>((_, timeoutReject) => {
                setTimeout(() => {
                    timeoutReject(new Error(`Job timed out after ${this.timeoutLimit} seconds`));
                }, this.timeoutLimit * 1000);
            });

            // Execute job and race against timeout
            const startTime = Date.now();
            const result = await Promise.race([
                fn(...args),
                timeoutPromise
            ]);
            executionTime = Date.now() - startTime;

            // Return successful result
            resolve({
                result,
                queueTime,
                executionTime
            });
        } catch (error) {
            // Forward any errors (including timeouts)
            reject(error);
        }
    }
}