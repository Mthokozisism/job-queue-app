# Job Queue Implementation

A TypeScript implementation of a job queue with concurrency control, rate limiting, and timeout handling.

## Features

- FIFO job processing
- Configurable concurrency limit
- Rate limiting (jobs per minute)
- Job timeout handling
- Queue metrics (size, active jobs)
- Proper error propagation

## Installation

```bash
npm install
npm run build
npm test

## Example Usage 
import { JobQueue } from './job-queue.js';

// Create a queue with custom options
const queue = new JobQueue({
    concurrencyLimit: 5,   // 5 concurrent jobs
    rateLimit: 60,         // 60 jobs per minute
    timeoutLimit: 30       // 30 second timeout
});

// Schedule jobs
const job1 = queue.schedule(async () => {
    // Do some work
    return 'result1';
});

const job2 = queue.schedule(async (param1, param2) => {
    // Do some work with parameters
    return param1 + param2;
}, 10, 20);

// Get queue metrics
console.log('Queue size:', queue.size());
console.log('Active jobs:', queue.active());

// Handle results
try {
    const result = await job1;
    console.log('Job completed:', result.result);
    console.log('Queue time:', result.queueTime, 'ms');
    console.log('Execution time:', result.executionTime, 'ms');
} catch (error) {
    console.error('Job failed:', error);
}

// Clean up
queue.dispose();
