# OpenClaw Kanban - Integration Guide

## Quick Start

### 1. Deploy with Docker Compose

```bash
# On your VPS, clone or copy the kanban files
cd /opt/openclaw-kanban  # or wherever you deploy

# Build and start
docker compose up -d --build

# Verify it's running
curl http://localhost:3000/api/stats
```

### 2. Connect OpenClaw

If OpenClaw runs in Docker on the same compose network:
```bash
export KANBAN_URL=http://kanban:3000
```

If OpenClaw runs on the host or separate container:
```bash
export KANBAN_URL=http://localhost:3000
```

### 3. Use the CLI Helper

Copy `scripts/kanban-cli.sh` to your OpenClaw workspace:
```bash
cp scripts/kanban-cli.sh /path/to/openclaw-workspace/scripts/
chmod +x /path/to/openclaw-workspace/scripts/kanban-cli.sh
```

## API Examples for OpenClaw

### Create a task when starting work
```bash
curl -X POST http://kanban:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Process morning emails",
    "description": "Check inbox, flag urgent items, draft responses",
    "status": "in_progress",
    "priority": "high",
    "assignee": "OpenClaw",
    "tags": ["email", "morning-routine"]
  }'
```

### Move a task when done
```bash
curl -X POST http://kanban:3000/api/tasks/<task-id>/move \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}'
```

### Update task progress
```bash
curl -X PATCH http://kanban:3000/api/tasks/<task-id> \
  -H "Content-Type: application/json" \
  -d '{"description": "Processed 42 emails. 3 flagged for human review."}'
```

### Check what's in progress
```bash
curl http://kanban:3000/api/tasks?status=in_progress
```

### Get board overview
```bash
curl http://kanban:3000/api/stats
```

## CLI Helper Usage

The `kanban-cli.sh` script provides a convenient wrapper around the REST API:

### Basic Examples

```bash
# View the entire board
./kanban-cli.sh board

# Show statistics
./kanban-cli.sh stats

# List all tasks
./kanban-cli.sh list

# List only in-progress tasks
./kanban-cli.sh list in_progress

# Create a new task
./kanban-cli.sh add "Fix authentication bug" \
  --priority high \
  --status todo \
  --assignee OpenClaw \
  --tags "bug,auth" \
  --description "Users unable to login with Google OAuth"

# Move a task to in_progress
./kanban-cli.sh move abc123-def456 in_progress

# Search for tasks
./kanban-cli.sh search "email"

# Get detailed task info
./kanban-cli.sh get abc123-def456

# Update a task
./kanban-cli.sh update abc123-def456 '{"priority":"critical"}'

# Delete a task
./kanban-cli.sh delete abc123-def456

# Clear all completed tasks
./kanban-cli.sh clear-done
```

### CLI Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `list [status]` | List all tasks, optionally filtered | `list in_progress` |
| `get <id>` | Get single task details | `get abc123` |
| `add <title> [opts]` | Create new task | `add "Fix bug" --priority high` |
| `update <id> <json>` | Update task fields | `update abc123 '{"priority":"high"}'` |
| `move <id> <status>` | Move to new column | `move abc123 done` |
| `delete <id>` | Delete a task | `delete abc123` |
| `stats` | Show board statistics | `stats` |
| `search <query>` | Search by title/description | `search login` |
| `clear-done` | Remove all completed tasks | `clear-done` |
| `board` | Show full board layout | `board` |

### Add Command Options

When creating tasks with `add`, you can use these flags:

- `--priority|-p <low|medium|high|critical>` - Set task priority (default: medium)
- `--status|-s <backlog|todo|in_progress|review|done>` - Set initial status (default: backlog)
- `--assignee|-a <name>` - Set assignee (default: OpenClaw)
- `--description|-d <text>` - Add detailed description
- `--tags|-t <comma,separated>` - Add tags (e.g., "bug,urgent,auth")

## OpenClaw Heartbeat Integration

Add to your OpenClaw workspace's `HEARTBEAT.md`:

```markdown
## Kanban Board Updates
- Before starting any task: Create or move a task to "in_progress" on the Kanban board
- After completing a task: Move it to "done" on the Kanban board
- Use the Kanban API at $KANBAN_URL to track all work
- Update task descriptions with progress notes and findings
```

## OpenClaw Automation Examples

### Task Lifecycle Automation

```bash
#!/bin/bash
# openclaw-task-wrapper.sh - Automatically track tasks on Kanban

TASK_TITLE="$1"
TASK_CMD="${@:2}"

# Create task and capture ID
RESPONSE=$(./kanban-cli.sh add "$TASK_TITLE" --status in_progress --priority medium)
TASK_ID=$(echo "$RESPONSE" | grep -oP 'ID: \K[a-f0-9-]+')

# Execute the actual work
echo "Starting: $TASK_TITLE"
START_TIME=$(date +%s)
$TASK_CMD
EXIT_CODE=$?
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Update task with results
if [ $EXIT_CODE -eq 0 ]; then
  ./kanban-cli.sh update "$TASK_ID" "{\"description\":\"Completed in ${DURATION}s\"}"
  ./kanban-cli.sh move "$TASK_ID" done
  echo "✅ Task completed and marked done on Kanban"
else
  ./kanban-cli.sh update "$TASK_ID" "{\"description\":\"Failed with exit code $EXIT_CODE after ${DURATION}s\",\"priority\":\"high\"}"
  ./kanban-cli.sh move "$TASK_ID" review
  echo "❌ Task failed and marked for review on Kanban"
fi

exit $EXIT_CODE
```

### Morning Sync Script

```bash
#!/bin/bash
# morning-sync.sh - Daily task sync for OpenClaw

# Create daily tasks
./kanban-cli.sh add "Check email inbox" \
  --status todo \
  --priority high \
  --tags "daily,communication"

./kanban-cli.sh add "Monitor server health" \
  --status todo \
  --priority medium \
  --tags "daily,monitoring"

./kanban-cli.sh add "Process overnight logs" \
  --status todo \
  --priority low \
  --tags "daily,logs"

# Clear yesterday's completed tasks
./kanban-cli.sh clear-done

# Show board status
echo "Today's Kanban Board:"
./kanban-cli.sh board
```

### Integration with OpenClaw TODO.md

```bash
#!/bin/bash
# sync-todo-to-kanban.sh - One-way sync from TODO.md to Kanban

TODO_FILE="/path/to/openclaw/TODO.md"

# Parse TODO.md and create tasks
while IFS= read -r line; do
  # Match lines like "- [ ] Task name"
  if [[ "$line" =~ ^-[[:space:]]\[[[:space:]]\][[:space:]](.+)$ ]]; then
    TASK_TITLE="${BASH_REMATCH[1]}"

    # Check if task already exists
    EXISTING=$(./kanban-cli.sh search "$TASK_TITLE" | grep -c "Found")

    if [ "$EXISTING" -eq 0 ]; then
      ./kanban-cli.sh add "$TASK_TITLE" \
        --status backlog \
        --priority medium \
        --assignee OpenClaw \
        --tags "from-todo"
      echo "✓ Created: $TASK_TITLE"
    fi
  fi
done < "$TODO_FILE"

echo "TODO sync complete. Run './kanban-cli.sh board' to view."
```

## Docker Networking

### Same Docker Compose Network

When both services are in the same `docker-compose.yml`:
- Kanban is accessible at `http://kanban:3000` from within the Docker network
- From the host machine: `http://localhost:3000`
- To expose externally, add a reverse proxy (nginx/caddy) in front

### Integrated docker-compose.yml Example

```yaml
version: "3.8"

services:
  kanban:
    build: .
    container_name: openclaw-kanban
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - kanban-data:/app/data
    environment:
      - NODE_ENV=production
    networks:
      - openclaw-net
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/stats"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  openclaw:
    image: openclaw/openclaw:latest
    container_name: openclaw
    restart: unless-stopped
    volumes:
      - ./openclaw-workspace:/app/workspace
      - openclaw-data:/app/data
    environment:
      - KANBAN_URL=http://kanban:3000
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - WHATSAPP_TOKEN=${WHATSAPP_TOKEN}
    networks:
      - openclaw-net
    depends_on:
      kanban:
        condition: service_healthy

volumes:
  kanban-data:
    driver: local
  openclaw-data:
    driver: local

networks:
  openclaw-net:
    driver: bridge
```

### Reverse Proxy (Optional)

If you want to access the board from your browser remotely, add to docker-compose.yml:

```yaml
  caddy:
    image: caddy:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
    networks:
      - openclaw-net
    depends_on:
      - kanban
```

With a `Caddyfile`:
```
kanban.yourdomain.com {
    reverse_proxy kanban:3000
}
```

Or with nginx:

```nginx
server {
    listen 80;
    server_name kanban.yourdomain.com;

    location / {
        proxy_pass http://kanban:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KANBAN_URL` | `http://localhost:3000` | Used by CLI helper |
| `KANBAN_PORT` | `3000` | Host port mapping in Docker |
| `NODE_ENV` | `production` | Node.js environment |

Set in your OpenClaw environment:

```bash
# Add to ~/.bashrc or OpenClaw's environment config
export KANBAN_URL=http://kanban:3000
```

Or in docker-compose.yml:

```yaml
environment:
  - KANBAN_URL=http://kanban:3000
```

## Persistent Data

Task data lives in the Docker volume `kanban-data`, mapped to `/app/data/tasks.json` inside the container.

### Backup

```bash
# Backup tasks to local file
docker cp openclaw-kanban:/app/data/tasks.json ./backup-tasks-$(date +%Y%m%d).json

# Or using docker compose
docker compose cp kanban:/app/data/tasks.json ./backup-tasks-$(date +%Y%m%d).json
```

### Restore

```bash
# Restore from backup
docker cp ./backup-tasks.json openclaw-kanban:/app/data/tasks.json
docker restart openclaw-kanban

# Or using docker compose
docker compose cp ./backup-tasks.json kanban:/app/data/tasks.json
docker compose restart kanban
```

### Automated Backups

Add a cron job on the host:

```bash
# Backup Kanban tasks daily at 2 AM
0 2 * * * docker cp openclaw-kanban:/app/data/tasks.json /backups/kanban/tasks-$(date +\%Y\%m\%d).json
```

## WebSocket Integration

For real-time updates, OpenClaw can connect to the WebSocket endpoint:

### JavaScript Example

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('ws://kanban:3000');

ws.on('open', () => {
  console.log('Connected to Kanban board WebSocket');
});

ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log(`Event: ${event.type}`, event.task);

  // React to task changes
  if (event.type === 'task_created' && event.task.assignee === 'OpenClaw') {
    console.log('New task assigned to me:', event.task.title);
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});
```

### Bash Example (using websocat)

```bash
# Install websocat: https://github.com/vi/websocat
websocat ws://kanban:3000 | while read -r line; do
  echo "Kanban update: $line"
  # Parse and react to events
done
```

## API Reference Quick Guide

See the main [README.md](README.md) for full API documentation. Here's a quick reference:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tasks` | GET | List all tasks (supports filtering) |
| `/api/tasks` | POST | Create new task |
| `/api/tasks/:id` | GET | Get single task |
| `/api/tasks/:id` | PATCH | Update task fields |
| `/api/tasks/:id` | DELETE | Delete task |
| `/api/tasks/:id/move` | POST | Move task to new status |
| `/api/tasks/bulk` | POST | Bulk create tasks |
| `/api/tasks?status=done` | DELETE | Clear completed tasks |
| `/api/stats` | GET | Get board statistics |

## Monitoring and Health Checks

The Kanban service includes a health check endpoint:

```bash
# Check if service is healthy
curl http://kanban:3000/api/stats

# In docker-compose, the healthcheck is automatic
docker compose ps
# Should show "healthy" status for kanban service
```

Set up monitoring alerts:

```bash
#!/bin/bash
# kanban-health-check.sh

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://kanban:3000/api/stats)

if [ "$HEALTH" != "200" ]; then
  echo "⚠️ Kanban board is unhealthy (HTTP $HEALTH)"
  # Send alert to OpenClaw or notification service
  curl -X POST http://openclaw:8080/alert \
    -d '{"message":"Kanban board health check failed","severity":"high"}'
fi
```

## Troubleshooting

### Can't connect from OpenClaw container

1. Verify both containers are on the same network:
   ```bash
   docker network ls
   docker network inspect openclaw-net
   ```

2. Check Kanban is running:
   ```bash
   docker compose ps kanban
   ```

3. Test connectivity from OpenClaw container:
   ```bash
   docker compose exec openclaw curl http://kanban:3000/api/stats
   ```

### Permission denied on kanban-cli.sh

Make the script executable:
```bash
chmod +x scripts/kanban-cli.sh
```

### Python not found

The CLI helper requires Python 3. Install on your VPS:
```bash
# Ubuntu/Debian
apt-get update && apt-get install -y python3

# Alpine Linux
apk add --no-cache python3
```

### Tasks not persisting

Check the volume is mounted:
```bash
docker compose down
docker volume ls | grep kanban-data
docker compose up -d
```

## Advanced Use Cases

### Priority-Based Task Routing

```bash
#!/bin/bash
# Route high-priority tasks to immediate action

./kanban-cli.sh list todo | grep "CRITICAL\|HIGH" | while read -r line; do
  if [[ "$line" =~ ID:\ ([a-f0-9-]+) ]]; then
    TASK_ID="${BASH_REMATCH[1]}"
    # Auto-move high-priority tasks to in_progress
    ./kanban-cli.sh move "$TASK_ID" in_progress
    echo "Auto-started high-priority task: $TASK_ID"
  fi
done
```

### Task Aging Alerts

```bash
#!/bin/bash
# Alert on tasks stuck in review for >24h

TASKS=$(curl -s http://kanban:3000/api/tasks?status=review)
NOW=$(date +%s)

echo "$TASKS" | python3 -c "
import sys, json
from datetime import datetime

tasks = json.load(sys.stdin)
now = $NOW

for t in tasks:
    updated = datetime.fromisoformat(t['updated_at'].replace('Z', '+00:00'))
    age_hours = (now - updated.timestamp()) / 3600

    if age_hours > 24:
        print(f'⚠️ Task stuck in review for {age_hours:.1f}h: {t[\"title\"]} ({t[\"id\"][:8]})')
"
```

### Daily Report Generation

```bash
#!/bin/bash
# Generate daily report for OpenClaw's work

REPORT_DATE=$(date +%Y-%m-%d)
STATS=$(curl -s http://kanban:3000/api/stats)

cat > "/reports/kanban-${REPORT_DATE}.txt" <<EOF
OpenClaw Kanban Daily Report - ${REPORT_DATE}
================================================

$(echo "$STATS" | python3 -c "
import sys, json
s = json.load(sys.stdin)
print(f'Total Tasks: {s[\"total\"]}')
print(f'Completed Today: {s[\"recentlyCompleted\"]}')
print()
print('Status Breakdown:')
for status, count in s['byStatus'].items():
    print(f'  {status:15s}: {count}')
print()
print('Priority Breakdown:')
for priority, count in s['byPriority'].items():
    print(f'  {priority:10s}: {count}')
")

Top Active Tasks:
$(./kanban-cli.sh list in_progress)
EOF

echo "Report saved to /reports/kanban-${REPORT_DATE}.txt"
```

## Security Considerations

### API Access Control

The current implementation has no authentication. For production:

1. Add API key authentication:
   ```bash
   export KANBAN_API_KEY="your-secret-key"
   ```

2. Use a reverse proxy with basic auth:
   ```nginx
   location /api {
       auth_basic "Kanban API";
       auth_basic_user_file /etc/nginx/.htpasswd;
       proxy_pass http://kanban:3000;
   }
   ```

3. Restrict network access with Docker networks (already configured)

### Data Privacy

- Task data is stored in plain JSON
- For sensitive information, consider encrypting the volume
- Regular backups should be stored securely

## Performance Tips

- Use query parameters to filter tasks instead of fetching all tasks
- For bulk operations, use `/api/tasks/bulk` endpoint
- WebSocket connection automatically receives updates (no polling needed)
- Consider archiving old completed tasks monthly

## Next Steps

1. Deploy the Kanban service to your VPS
2. Add CLI helper to OpenClaw's scripts directory
3. Configure environment variables
4. Test integration with sample tasks
5. Set up automated backups
6. Create OpenClaw automation scripts for your workflow

For more details on the API endpoints and data models, see [README.md](README.md).
