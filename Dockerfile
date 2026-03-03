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

# Run as non-root
RUN addgroup -S app && adduser -S app -G app

# 7. نسخ الملفات من مرحلة البناء
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/package.json ./

USER app

# 8. تشغيل التطبيق
CMD ["npm", "run", "start"]
