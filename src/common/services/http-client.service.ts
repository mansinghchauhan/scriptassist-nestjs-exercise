import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisConnectionService } from './redis-connection.service';

export interface HttpRequestOptions {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: any;
    timeoutMs?: number;
    retries?: number;
    backoffMs?: number;
}

@Injectable()
export class HttpClientService {
    private readonly logger = new Logger(HttpClientService.name);

    constructor(
        private readonly configService: ConfigService,
        private readonly redisConnectionService: RedisConnectionService,
    ) { }

    async request(url: string, options: HttpRequestOptions = {}): Promise<Response> {
        const method = options.method || 'GET';
        const headers = options.headers || {};
        const timeoutMs = options.timeoutMs ?? 5000;
        const maxRetries = options.retries ?? 3;
        const backoffMs = options.backoffMs ?? 500;

        // Circuit breaker using Redis connection health as surrogate if desired
        if (this.redisConnectionService.isCircuitBreakerOpen()) {
            throw new Error('Circuit breaker open - refusing external request');
        }

        let lastError: any;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                const res = await fetch(url, {
                    method,
                    headers,
                    body: options.body ? JSON.stringify(options.body) : undefined,
                    signal: controller.signal,
                } as any);
                clearTimeout(timer);

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                return res;
            } catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    const delay = backoffMs * attempt;
                    this.logger.warn(`HTTP ${method} ${url} failed (attempt ${attempt}): ${error instanceof Error ? error.message : String(error)} - retrying in ${delay}ms`);
                    await new Promise((r) => setTimeout(r, delay));
                    continue;
                }
            }
        }

        this.logger.error(`HTTP ${method} ${url} failed after ${maxRetries} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
        throw lastError;
    }
}


