// Bộ gộp yêu cầu tải lại: tối đa một yêu cầu đang chạy và một yêu cầu chờ; kích hoạt dồn dập chỉ để lại một lượt chờ.

export interface Refresher {
  trigger(): void;
}

export function createRefresher(run: () => Promise<void>): Refresher {
  let running = false;
  let pending = false;

  async function go() {
    running = true;
    do {
      pending = false;
      try {
        await run();
      } catch {
        // lỗi tải do `run` tự báo; lượt chờ (nếu có) vẫn chạy tiếp
      }
    } while (pending);
    running = false;
  }

  return {
    trigger() {
      if (running) pending = true;
      else void go();
    },
  };
}
