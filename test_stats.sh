set -e
RESPONSE="{\"uptime_seconds\": 1234, \"metrics\": {\"totalRequests\": 10, \"successfulRequests\": 10, \"errors\": {\"total\": 0, \"donorBans\": 0, \"rateLimits\": 0, \"internal\": 0}}}"
BODY="$RESPONSE"
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
echo "$STATS_MSG"
