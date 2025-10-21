import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'InternalServerError';
    let details: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exception.message;
        error = (exceptionResponse as any).error || exception.name;
        details = (exceptionResponse as any).details;
      } else {
        message = exception.message;
        error = exception.name;
      }
    } else if (exception instanceof QueryFailedError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Database operation failed';
      error = 'DatabaseError';

      // Log the actual database error for debugging
      this.logger.error('Database error:', exception.message);
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;

      // Log unexpected errors
      this.logger.error('Unexpected error:', exception.stack);
    }

    // Log the error with appropriate level
    if (status >= 500) {
      this.logger.error(
        `HTTP ${status} Error: ${message}`,
        {
          path: request.url,
          method: request.method,
          userAgent: request.get('User-Agent'),
          ip: request.ip,
          stack: exception instanceof Error ? exception.stack : undefined,
        }
      );
    } else {
      this.logger.warn(
        `HTTP ${status} Error: ${message}`,
        {
          path: request.url,
          method: request.method,
          ip: request.ip,
        }
      );
    }

    // Format error response
    const errorResponse: any = {
      success: false,
      statusCode: status,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    // Include details only for client errors (4xx) and in development
    if (details && status < 500) {
      errorResponse.details = details;
    }

    // Include request ID if available
    if (request.headers['x-request-id']) {
      errorResponse.requestId = request.headers['x-request-id'];
    }

    response.status(status).json(errorResponse);
  }
} 