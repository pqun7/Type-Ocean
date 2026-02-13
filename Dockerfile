# 1. استخدم صورة رسمية لـ Node.js
FROM node:18-alpine AS builder

# 2. ضبط متغيرات البيئة
ENV NODE_ENV=production

# 3. تحديد مجلد العمل داخل الحاوية
WORKDIR /app

# 4. نسخ ملفات المشروع
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY . .

# 5. تثبيت التبعيات (npm)
RUN npm ci
RUN npx prisma generate
RUN npm run build

# 6. إنشاء المرحلة النهائية
FROM node:18-alpine AS runner
WORKDIR /app

# 7. نسخ الملفات من مرحلة البناء
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./

# 8. تشغيل التطبيق
CMD ["npm", "run", "start"]
