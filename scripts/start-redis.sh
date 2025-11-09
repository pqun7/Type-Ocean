#!/bin/bash

echo "🚀 Starting Redis in WSL..."

# التحقق من حالة Redis
if ! sudo service redis-server status > /dev/null 2>&1; then
    echo "🔧 Starting Redis server..."
    sudo service redis-server start
else
    echo "✅ Redis is already running"
fi

# اختبار الاتصال
echo "🧪 Testing Redis connection..."
if redis-cli ping | grep -q "PONG"; then
    echo "✅ Redis is working correctly"
else
    echo "❌ Failed to connect to Redis"
    echo "💡 Try running: sudo service redis-server restart"
    exit 1
fi