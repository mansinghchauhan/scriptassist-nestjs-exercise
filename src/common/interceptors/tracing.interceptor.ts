import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const http = context.switchToHttp();
        const req = http.getRequest();
        const res = http.getResponse();

        const requestId = req.headers['x-request-id'] || '-';
        const start = Date.now();

        res.setHeader('X-Request-ID', requestId);

        return next.handle().pipe(
            tap(() => {
                const duration = Date.now() - start;
                // Minimal tracing via headers
                res.setHeader('X-Response-Time', `${duration}ms`);
            })
        );
    }
}


