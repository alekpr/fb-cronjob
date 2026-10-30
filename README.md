# fb-cronjob

เครื่องมือโพสต์ Facebook **อัตโนมัติเมื่อถึงเวลา** บนเครื่อง local (Node.js + Express + SQLite)
เก็บ **คิวโพสต์ (jobs)** ในเครื่อง แล้วเมื่อถึงเวลาที่ตั้งไว้จะ **โพสต์ทันที** (`published=true`) ไปยัง Page ที่เลือก

> ต่างจาก [fb-scheduler](../fb-scheduler) ที่ใช้ native `scheduled_publish_time` —
> ตัวนี้ **เครื่องต้องเปิดค้างอยู่** เพราะระบบโพสต์เองตอนถึงเวลา

## ความสามารถ
- กรอกโพสต์ใน UI ทีละตัว (ข้อความ + media + เลือกเพจ)
- **หลายเพจ** — เพิ่มเพจได้หลายตัว เลือกเพจเป้าหมายต่อโพสต์ (ตั้ง default ได้)
- **ตารางเวลา**: ครั้งเดียว / ทุกวัน / ทุกสัปดาห์ / ทุกเดือน
- พลาดเวลา (เครื่องปิด) → **catch-up** โพสต์ทันทีเมื่อเปิดเครื่อง
- ภาพ/วิดีโอ/carousel, วิดีโอใหญ่ (>50 MB) ใช้ resumable upload
- คิวพร้อมสถานะ + นับถอยหลัง + ปุ่ม หยุด/ทำต่อ/โพสต์เลย/ลบ
- ประวัติการโพสต์ (สำเร็จ/ล้มเหลว + fb_post_id)
- นำเข้าเพจจาก User Token (`/me/accounts`) หรือวาง Page ID + Token เอง
- **Dry-run mode** — จำลอง publish โดยไม่ยิง Facebook จริง

## Requirements
- Node.js **≥ 22.5** (ใช้ `node:sqlite` ในตัว)
- Facebook App + Page + Page Access Token (ดูวิธีสร้างใน [fb-scheduler README](../fb-scheduler#วิธีสร้าง-page-access-token-long-lived))

## ติดตั้ง & รัน
```bash
npm install
npm start            # http://localhost:3000 (DRY_RUN=true ค่าเริ่มต้น)
DRY_RUN=false npm start   # เปิดโพสต์จริง
```

## รันด้วย Docker
```bash
docker compose up -d --build
docker compose logs -f
docker compose down
```
- bind เฉพาะ `127.0.0.1:3000` (แอปไม่มีระบบ login)
- `restart: unless-stopped` — ต้องเปิดเครื่อง/container ค้างไว้
- ข้อมูล persist ใน `./data`, `./uploads`, `./logs`

## การตั้งค่าเพจ
แท็บ **"ตั้งค่าเพจ"**:
1. **วางเอง** — กรอก Page ID + Page Access Token
2. **นำเข้าจาก User Token** — วาง long-lived user token ครั้งเดียว ระบบดึงทุกเพจให้อัตโนมัติ

## ตารางเวลา (Recurrence)
| ชนิด | ความหมาย | ฟิลด์ |
|---|---|---|
| `once` | ครั้งเดียว | วัน-เวลา |
| `daily` | ทุกวัน | เวลา |
| `weekly` | ทุกสัปดาห์ | เวลา + วันในสัปดาห์ (เลือกได้หลายวัน) |
| `monthly` | ทุกเดือน | เวลา + วันที่ (1–31, clamp ตามเดือน) |

เวลาใช้เขตเวลา **Asia/Bangkok** (ตั้ง `TIMEZONE` ได้)

## Environment variables

| ตัวแปร | คำอธิบาย | ค่าเริ่มต้น |
|---|---|---|
| `PORT` | พอร์ต | `3000` |
| `HOST` | ที่อยู่ bind | `127.0.0.1` |
| `TIMEZONE` | เขตเวลา | `Asia/Bangkok` |
| `GRAPH_VERSION` | เวอร์ชัน Graph API | `v21.0` |
| `DRY_RUN` | `true` = ไม่ยิง Facebook จริง | `true` |
| `LOG_LEVEL` | ระดับ log | `info` |

## Flow การทำงาน
1. สร้างโพสต์ในคิว → คำนวณ `next_run_at` (unix)
2. Scheduler (poller ทุก ~15s) ตรวจ job ที่ถึงเวลา → dispatch ผ่านคิว concurrency=1
3. ถึงเวลา: upload media (`published=false`) → `POST /{page}/feed` พร้อม `published=true`
4. สำเร็จ → `run_count+1`, recurring คำนวณรอบถัดไป / ครั้งเดียว → `done`
5. ล้มเหลว → `failed` + error, มีปุ่ม retry (โพสต์เลย)

## โครงสร้าง
```
src/
├── server.js            # entry
├── app.js               # Express app
├── db/db.js             # node:sqlite: pages/jobs/history
├── routes/              # pages / jobs / logs
├── services/            # scheduler, recurrence, fbService, mediaService, rateLimiter
└── public/              # UI (vanilla SPA)
uploads/media/{jobId}/   # media แต่ละโพสต์ (gitignored)
data/scheduler.db        # SQLite (gitignored)
```

## ข้อควรรู้ / ข้อจำกัด
- โพสต์เกิดขึ้นจริงเฉพาะเมื่อเครื่อง/container เปิดอยู่ตอนถึงเวลา
- ความแม่นยำ ±15 วินาที (ช่วง poll) — ปรับ `startScheduler(intervalMs)` ได้
- Recurring ที่พลาดหลายรอบตอนปิดเครื่อง → โพสต์ 1 ครั้ง แล้วคำนวณรอบถัดจากเวลาปัจจุบัน
- ไม่มีระบบ login ผู้ใช้ — อย่า bind พอร์ตสู่ภายนอก, token เก็บในเครื่องเท่านั้น
