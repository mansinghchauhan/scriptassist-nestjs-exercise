import { registerAs } from '@nestjs/config';

export interface RateLimitOptions {
    limit: number;
    windowMs: number;
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
    keyGenerator?: string;
}

export interface RateLimitConfig {
    global: RateLimitOptions;
    auth: RateLimitOptions;
    tasks: RateLimitOptions;
    users: RateLimitOptions;
    api: RateLimitOptions;
}

export default registerAs('rateLimit', (): RateLimitConfig => ({
    global: {
        limit: parseInt(process.env.RATE_LIMIT_GLOBAL_LIMIT || '1000', 10),
        windowMs: parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || '60000', 10), // 1 minute
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        keyGenerator: 'ip',
    },
    auth: {
        limit: parseInt(process.env.RATE_LIMIT_AUTH_LIMIT || '20', 10),
        windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || '60000', 10), // 1 minute
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        keyGenerator: 'ip',
    },
    tasks: {
        limit: parseInt(process.env.RATE_LIMIT_TASKS_LIMIT || '100', 10),
        windowMs: parseInt(process.env.RATE_LIMIT_TASKS_WINDOW_MS || '60000', 10), // 1 minute
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        keyGenerator: 'user',
    },
    users: {
        limit: parseInt(process.env.RATE_LIMIT_USERS_LIMIT || '50', 10),
        windowMs: parseInt(process.env.RATE_LIMIT_USERS_WINDOW_MS || '60000', 10), // 1 minute
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        keyGenerator: 'user',
    },
    api: {
        limit: parseInt(process.env.RATE_LIMIT_API_LIMIT || '200', 10),
        windowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS || '60000', 10), // 1 minute
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        keyGenerator: 'ip',
    },
}));
