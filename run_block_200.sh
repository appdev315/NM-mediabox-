set -e
RESPONSE="{\"uptime_seconds\": 1234, \"metrics\": {\"totalRequests\": 10, \"successfulRequests\": 10, \"errors\": {\"total\": 0, \"donorBans\": 0, \"rateLimits\": 0, \"internal\": 0}}}
200"
          
HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
          
if [ "$HTTP_STATUS" -ne 200 ]; then
  echo "Failed to fetch stats, status code: $HTTP_STATUS"
  echo "ERROR_MSG=⚠️ Не удалось получить статистику с сервера (Код $HTTP_STATUS)" >> $GITHUB_ENV
else
  UPTIME=$(echo "$BODY" | jq -r '.uptime_seconds')
  TOTAL=$(echo "$BODY" | jq -r '.metrics.totalRequests')
  SUCCESS=$(echo "$BODY" | jq -r '.metrics.successfulRequests')
  ERRORS=$(echo "$BODY" | jq -r '.metrics.errors.total')
  BANS=$(echo "$BODY" | jq -r '.metrics.errors.donorBans')
  RL=$(echo "$BODY" | jq -r '.metrics.errors.rateLimits')
  INTERNAL=$(echo "$BODY" | jq -r '.metrics.errors.internal')
            
  HOURS=$(($UPTIME / 3600))
  MINUTES=$((($UPTIME % 3600) / 60))
            
  STATS_MSG=$(cat <<EOF
  📊 <b>Ежедневная сводка Media-Box</b>
            
  ⏳ Аптайм (с момента старта/рестарта): ${HOURS}ч ${MINUTES}м
  🌐 Всего запросов за день: <b>${TOTAL}</b>
  ✅ Успешно: <b>${SUCCESS}</b>
  ❌ Всего ошибок: <b>${ERRORS}</b>
            
  Детализация ошибок:
  🚫 Баны от доноров (403): ${BANS}
  🛑 DDoS/Парсеры (Rate Limit 429): ${RL}
  🔥 Внутренние ошибки парсера (500): ${INTERNAL}
EOF
  )
  STATS_MSG=$(echo "$STATS_MSG" | sed 's/^[ \t]*//')
  # Use printf to handle newlines correctly for GITHUB_ENV
  echo "STATS_MSG<<EOF" >> $GITHUB_ENV
  echo "$STATS_MSG" >> $GITHUB_ENV
  echo "EOF" >> $GITHUB_ENV
fi
