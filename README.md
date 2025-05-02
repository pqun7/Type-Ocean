# 🕒 Cron Job Setup for `/api/cron`

This guide explains how to set up a scheduled cron job to automatically trigger the `/api/cron` endpoint daily. This endpoint handles routine tasks such as cleaning up expired tokens, rate limits, and running database optimizations.

---

## 📌 Prerequisites

- A running Next.js server with `/api/cron` route implemented.
- Public URL (e.g., `https://yourdomain.com`) **or** local server (`http://localhost:3000`).
- A UNIX-like system (Linux/macOS) with `cron` and `curl` installed.

---

## ✅ Cron Job Command (Production)

To trigger the cleanup every day:

```bash
0 * * * * curl -s http://localhost:3000/api/cron >> /var/log/cron.log 2>&1
