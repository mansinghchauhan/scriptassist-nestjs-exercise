import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: Number(__ENV.VUS || 10),
    duration: __ENV.DURATION || '30s',
    thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<500'],
    },
};

export default function () {
    const baseUrl = __ENV.BASE_URL || 'http://localhost:3000';
    const res = http.get(`${baseUrl}/health/liveness`, {
        headers: { 'X-Request-ID': `${__VU}-${Date.now()}` },
    });
    check(res, {
        'status is 200': (r) => r.status === 200,
    });
    sleep(1);
}


