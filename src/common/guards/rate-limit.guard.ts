import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';
import { RateLimitService } from '../services/rate-limit.service';
import { RateLimitOptions } from '../../config/rate-limit.config';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly defaultOptions: RateLimitOptions = {
    limit: 100,
    windowMs: 60000, // 1 minute
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    keyGenerator: 'ip',
  };

  constructor(
    private reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
    private readonly configService: ConfigService,
  ) { }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();

    // Get rate limit options from decorator metadata
    const rateLimitOptions = this.getRateLimitOptions(context);

    // Skip rate limiting if disabled
    if (this.shouldSkipRateLimit(rateLimitOptions)) {
      return true;
    }

    // Generate rate limit key based on configuration
    const key = this.generateRateLimitKey(request, rateLimitOptions);
    const identifier = this.getIdentifier(request, rateLimitOptions);

    return this.handleRateLimit(key, rateLimitOptions, identifier, request);
  }

  private getRateLimitOptions(context: ExecutionContext): RateLimitOptions {
    const handler = context.getHandler();
    const classRef = context.getClass();

    // Check for rate limit metadata on handler first, then class
    const handlerOptions = this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, handler);
    const classOptions = this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, classRef);

    // Get default configuration from config service
    const configOptions = this.configService.get('rateLimit.global');

    return handlerOptions || classOptions || configOptions || this.defaultOptions;
  }

  private shouldSkipRateLimit(options: RateLimitOptions): boolean {
    // Skip rate limiting in development if explicitly configured
    const isDevelopment = process.env.NODE_ENV === 'development';
    const skipInDevelopment = process.env.RATE_LIMIT_SKIP_DEV === 'true';

    return isDevelopment && skipInDevelopment;
  }

  private generateRateLimitKey(request: any, options: RateLimitOptions): string {
    const route = request.route?.path || request.url;
    const method = request.method;

    // Use route-specific key for better granularity
    return `${method}:${route}`;
  }

  private getIdentifier(request: any, options: RateLimitOptions): string {
    const keyGenerator = options.keyGenerator || 'ip';

    switch (keyGenerator) {
      case 'user':
        return this.getUserId(request) || this.getClientIp(request);
      case 'ip':
      default:
        return this.getClientIp(request);
    }
  }

  private getUserId(request: any): string | null {
    // Try to get user ID from JWT payload or user object
    return request.user?.id || request.user?.sub || null;
  }

  private getClientIp(request: any): string {
    // Get IP from various headers for better accuracy
    const forwarded = request.headers['x-forwarded-for'];
    const realIp = request.headers['x-real-ip'];
    const remoteAddress = request.connection?.remoteAddress || request.socket?.remoteAddress;

    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }

    if (realIp) {
      return realIp;
    }

    return remoteAddress || 'unknown';
  }

  private async handleRateLimit(
    key: string,
    options: RateLimitOptions,
    identifier: string,
    request: any,
  ): Promise<boolean> {
    try {
      const result = await this.rateLimitService.checkRateLimit(key, options, identifier);

      // Add rate limit headers to response
      this.addRateLimitHeaders(request, result);

      if (!result.allowed) {
        this.logger.warn(
          `Rate limit exceeded for ${identifier} on ${key}: ${result.current}/${result.limit}`,
        );

        throw new HttpException(
          {
            message: 'Rate limit exceeded',
            retryAfter: result.retryAfter,
            limit: result.limit,
            current: result.current,
            remaining: result.remaining,
            resetTime: new Date(result.resetTime).toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      this.logger.debug(
        `Rate limit check passed for ${identifier} on ${key}: ${result.current}/${result.limit}`,
      );

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(`Rate limit check failed for ${identifier} on ${key}:`, error);

      // In case of service failure, allow the request but log the error
      // This prevents rate limiting from breaking the application
      return true;
    }
  }

  private addRateLimitHeaders(request: any, result: any): void {
    const response = request.res;

    if (response && !response.headersSent) {
      response.setHeader('X-RateLimit-Limit', result.limit);
      response.setHeader('X-RateLimit-Remaining', result.remaining);
      response.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

      if (result.retryAfter) {
        response.setHeader('Retry-After', result.retryAfter);
      }
    }
  }
}
