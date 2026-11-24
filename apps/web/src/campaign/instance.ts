// Store dùng chung của ứng dụng (main.tsx nối vào kênh SSE, UI đọc qua useSyncExternalStore). `/api` do Vite proxy sang server.
import { createApiClient } from './api.ts';
import { createCampaignStore } from './campaignStore.ts';

export const api = createApiClient({ baseUrl: '/api' });
export const campaignStore = createCampaignStore(api);
