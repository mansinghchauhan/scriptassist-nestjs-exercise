import { SetMetadata } from '@nestjs/common';
import { RateLimitOptions } from '../../config/rate-limit.config';

export const RATE_LIMIT_KEY = 'rateLimit';

// Predefined rate limit configurations
export const RateLimits = {
  // Auth endpoints - normal but secure
  AUTH: { limit: 20, windowMs: 60000, keyGenerator: 'ip' }, // 20 requests per minute
  LOGIN: { limit: 10, windowMs: 60000, keyGenerator: 'ip' }, // 10 login attempts per minute

  // API endpoints - moderate
  API: { limit: 200, windowMs: 60000, keyGenerator: 'ip' }, // 200 requests per minute
  TASKS: { limit: 100, windowMs: 60000, keyGenerator: 'user' }, // 100 requests per minute per user
  USERS: { limit: 50, windowMs: 60000, keyGenerator: 'user' }, // 50 requests per minute per user

  // Global fallback
  GLOBAL: { limit: 1000, windowMs: 60000, keyGenerator: 'ip' }, // 1000 requests per minute
} as const;

export const RateLimit = (options: RateLimitOptions) => {
  return SetMetadata(RATE_LIMIT_KEY, options);
}; 