const { Anthropic } = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: 'test', baseURL: 'https://api.minimaxi.com/anthropic' });
const req = client.buildRequest({ method: 'post', path: '/messages', body: {} });
console.log('Build Request URL:', req.url);

const client2 = new Anthropic({ apiKey: 'test', baseURL: 'https://api.minimaxi.com/anthropic/v1' });
const req2 = client2.buildRequest({ method: 'post', path: '/messages', body: {} });
console.log('Build Request URL 2:', req2.url);
