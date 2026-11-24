// Kết nối live duy nhất của trang, mở một lần ngoài React (StrictMode chạy effect hai lần nên không đặt trong useEffect).
// `/api` do Vite proxy sang server (cùng origin, không cần CORS).

import { campaignStore } from '../campaign/instance.ts';
import { notices } from '../notify/instance.ts';
import { approvalStore } from '../sim/approvalStore.ts';
import { office } from '../sim/officeStore.ts';
import { createLiveConnection } from './connection.ts';
import { fanOutSink } from './fanOut.ts';

export const live = createLiveConnection({ baseUrl: '/api', sink: fanOutSink(office, campaignStore, approvalStore, notices) });

// Còn chiến dịch chưa xong → giờ làm việc: nhân viên rảnh vẫn ngồi bàn; mọi chiến dịch xong hết mới ra bar.
const OPEN = new Set(['briefing', 'active', 'paused']);
campaignStore.subscribe(() => office.setWorkday(campaignStore.get().campaigns.some((c) => OPEN.has(c.status))));
