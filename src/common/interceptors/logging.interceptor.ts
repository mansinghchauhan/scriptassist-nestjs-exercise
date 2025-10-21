import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { PerformanceMonitorService } from '../services/performance-monitor.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  constructor(private readonly performanceMonitor: PerformanceMonitorService) { }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const method = req.method;
    const url = req.url;
    const userAgent = req.get('User-Agent') || '';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const requestId = req.headers['x-request-id'] as string || 'unknown';
    const userId = (req as any).user?.id || 'anonymous';
    const now = Date.now();

    // Log incoming request
    this.logger.log({
      message: 'Incoming request',
      method,
      url,
      ip,
      userAgent,
      requestId,
      userId,
      timestamp: new Date().toISOString(),
    });

    return next.handle().pipe(
      tap({
        next: (response) => {
          const duration = Date.now() - now;
          const statusCode = res.statusCode;

          this.logger.log({
            message: 'Request completed',
            method,
            url,
            statusCode,
            duration: `${duration}ms`,
            ip,
            requestId,
            userId,
            timestamp: new Date().toISOString(),
          });

          // Record request metric
          this.performanceMonitor.recordOperationMetric(`HTTP ${method} ${url}`, duration, true);
        },
        error: (error) => {
          const duration = Date.now() - now;
          const statusCode = error.status || 500;

          this.logger.error({
            message: 'Request failed',
            method,
            url,
            statusCode,
            duration: `${duration}ms`,
            ip,
            requestId,
            userId,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
          });

          // Record failed request metric
          this.performanceMonitor.recordOperationMetric(`HTTP ${method} ${url}`, duration, false, error.message);
        },
      }),
      catchError((error) => {
        const duration = Date.now() - now;
        const statusCode = error.status || 500;

        this.logger.error({
          message: 'Request error caught',
          method,
          url,
          statusCode,
          duration: `${duration}ms`,
          ip,
          requestId,
          userId,
          error: error.message,
          timestamp: new Date().toISOString(),
        });

        // Record failed request metric
        this.performanceMonitor.recordOperationMetric(`HTTP ${method} ${url}`, duration, false, error.message);

        throw error;
      }),
    );
  }
} 