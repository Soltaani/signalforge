import type { SignalForgeConfig } from './schema.js';

export const DEFAULT_CONFIG: SignalForgeConfig = {
  agent: {
    provider: 'openai',
    model: 'gpt-5.2',
    temperature: 0.2,
    endpoint: null,
    maxTokens: null,
    contextWindowTokens: 400_000,
    reserveTokens: 30_000,
  },
  feeds: [
    { id: 'hn', url: 'https://hnrss.org/frontpage', tier: 1, weight: 1.0, enabled: true, tags: ['tech', 'startups'] },
    { id: 'reddit', url: 'https://www.reddit.com/r/SaaS+microsaas+startups/.rss', tier: 1, weight: 1.0, enabled: true, tags: ['saas', 'startups'] },
    { id: 'techcrunch', url: 'https://techcrunch.com/feed/', tier: 1, weight: 1.0, enabled: true, tags: ['tech', 'funding'] },
    { id: 'venturebeat', url: 'https://venturebeat.com/feed/', tier: 1, weight: 1.0, enabled: true, tags: ['tech', 'ai'] },
    { id: 'verge', url: 'https://www.theverge.com/rss/index.xml', tier: 2, weight: 0.6, enabled: true, tags: ['tech'] },
    { id: 'engadget', url: 'https://www.engadget.com/rss.xml', tier: 2, weight: 0.6, enabled: true, tags: ['tech'] },
    { id: 'wired', url: 'https://www.wired.com/feed/rss', tier: 2, weight: 0.6, enabled: true, tags: ['tech'] },
    { id: 'geekwire', url: 'https://www.geekwire.com/feed/', tier: 3, weight: 0.4, enabled: false, tags: ['tech', 'seattle'] },
  ],
  thresholds: {
    minScore: 65,
    minClusterSize: 2,
    dedupeThreshold: 0.88,
  },
};
