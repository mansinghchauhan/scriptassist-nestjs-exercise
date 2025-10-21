import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

@Injectable()
export class SanitizationPipe implements PipeTransform {
    transform(value: any, metadata: ArgumentMetadata) {
        if (typeof value === 'object' && value !== null) {
            return this.sanitizeObject(value);
        }

        if (typeof value === 'string') {
            return this.sanitizeString(value);
        }

        return value;
    }

    private sanitizeObject(obj: any): any {
        const sanitized: any = {};

        for (const [key, val] of Object.entries(obj)) {
            // Sanitize keys
            const sanitizedKey = this.sanitizeString(key);

            if (typeof val === 'string') {
                sanitized[sanitizedKey] = this.sanitizeString(val);
            } else if (typeof val === 'object' && val !== null) {
                sanitized[sanitizedKey] = this.sanitizeObject(val);
            } else {
                sanitized[sanitizedKey] = val;
            }
        }

        return sanitized;
    }

    private sanitizeString(str: string): string {
        if (typeof str !== 'string') {
            return str;
        }

        return str
            // Remove potential script tags
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            // Remove potential HTML tags
            .replace(/<[^>]*>/g, '')
            // Remove potential SQL injection patterns
            .replace(/('|(\\')|(;)|(\\)|(\-)|(\*)|(\%)|(\_)|(\+)|(\=)|(\|)|(\^)|(\~)|(\`)|(\!)|(\@)|(\#)|(\$)|(\&)|(\()|(\))|(\[)|(\])|(\{)|(\})|(\:)|(\;)|(\")|(\<)|(\>)|(\?)|(\/)|(\\)|(\|))/g, '')
            // Trim whitespace
            .trim();
    }
}
