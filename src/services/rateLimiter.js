/**
 * คิวจำกัดอัตราการยิง request (ค่าเริ่มต้น 1 req/sec)
 * คืนฟังก์ชัน schedule(fn) -> Promise ที่เว้นระยะห่างระหว่าง task
 */
export function createRateLimiter(requestsPerSecond = 1) {
  let chain = Promise.resolve();
  const spacing = 1000 / requestsPerSecond;

  return function schedule(fn) {
    const run = chain.then(fn);
    chain = run.catch(() => {});
    chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, spacing)));
    return run;
  };
}
