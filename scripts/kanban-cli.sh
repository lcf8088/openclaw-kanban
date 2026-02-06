#!/bin/bash
# kanban-cli.sh - OpenClaw Kanban Board CLI Helper
# Usage: ./kanban-cli.sh <command> [args...]
#
# Commands:
#   list [status]              - List all tasks, optionally filtered by status
#   get <id>                   - Get a single task
#   add <title> [options]      - Create a new task
#   update <id> <json>         - Update a task
#   move <id> <status>         - Move a task to a new column
#   delete <id>               - Delete a task
#   stats                     - Show board statistics
#   search <query>            - Search tasks by title/description
#   clear-done                - Remove all completed tasks
#   board                     - Show a text-based board summary
#
# Environment:
#   KANBAN_URL - Base URL (default: http://localhost:3000)
#
# Examples:
#   ./kanban-cli.sh add "Fix login bug" --priority high --status todo --assignee OpenClaw --tags "bug,auth"
#   ./kanban-cli.sh move abc-123 in_progress
#   ./kanban-cli.sh list in_progress
#   ./kanban-cli.sh board
#
# Note: On Windows, use Git Bash or WSL. Make executable with: chmod +x kanban-cli.sh

set -euo pipefail

KANBAN_URL="${KANBAN_URL:-http://localhost:3000}"
API="${KANBAN_URL}/api"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Priority colors
priority_color() {
  case "$1" in
    critical) echo -e "${RED}" ;;
    high)     echo -e "${YELLOW}" ;;
    medium)   echo -e "${BLUE}" ;;
    low)      echo -e "${GREEN}" ;;
    *)        echo -e "${NC}" ;;
  esac
}

# Status icons
status_icon() {
  case "$1" in
    backlog)     echo "📋" ;;
    todo)        echo "📝" ;;
    in_progress) echo "⚡" ;;
    review)      echo "🔍" ;;
    done)        echo "✅" ;;
    *)           echo "❓" ;;
  esac
}

cmd_list() {
  local status="${1:-}"
  local url="${API}/tasks"
  if [ -n "$status" ]; then
    url="${url}?status=${status}"
  fi

  local tasks
  tasks=$(curl -s "$url")

  echo "$tasks" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
if not tasks:
    print('  No tasks found.')
    sys.exit(0)
for t in tasks:
    priority = t.get('priority', 'medium').upper()
    status = t.get('status', 'unknown')
    title = t.get('title', 'Untitled')
    assignee = t.get('assignee', 'Unassigned')
    task_id = t.get('id', '?')[:8]
    print(f'  [{priority:8s}] {title}')
    print(f'           Status: {status} | Assignee: {assignee} | ID: {task_id}...')
    print()
"
}

cmd_get() {
  local id="$1"
  curl -s "${API}/tasks/${id}" | python3 -m json.tool
}

cmd_add() {
  local title="$1"
  shift

  # Parse optional flags
  local priority="medium"
  local status="backlog"
  local assignee="OpenClaw"
  local description=""
  local tags="[]"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --priority|-p) priority="$2"; shift 2 ;;
      --status|-s) status="$2"; shift 2 ;;
      --assignee|-a) assignee="$2"; shift 2 ;;
      --description|-d) description="$2"; shift 2 ;;
      --tags|-t)
        # Convert comma-separated to JSON array
        tags=$(echo "$2" | python3 -c "import sys; print('[' + ','.join(['\"' + t.strip() + '\"' for t in sys.stdin.read().strip().split(',')]) + ']')")
        shift 2 ;;
      *) shift ;;
    esac
  done

  local body
  body=$(cat <<EOF
{
  "title": "${title}",
  "description": "${description}",
  "status": "${status}",
  "priority": "${priority}",
  "assignee": "${assignee}",
  "tags": ${tags}
}
EOF
)

  local result
  result=$(curl -s -X POST "${API}/tasks" \
    -H "Content-Type: application/json" \
    -d "$body")

  local new_id
  new_id=$(echo "$result" | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")

  echo -e "${GREEN}✓ Task created:${NC} ${title}"
  echo -e "  ID: ${new_id}"
  echo -e "  Status: ${status} | Priority: ${priority} | Assignee: ${assignee}"
}

cmd_update() {
  local id="$1"
  local json_data="$2"

  curl -s -X PATCH "${API}/tasks/${id}" \
    -H "Content-Type: application/json" \
    -d "$json_data" | python3 -m json.tool
}

cmd_move() {
  local id="$1"
  local new_status="$2"

  local result
  result=$(curl -s -X POST "${API}/tasks/${id}/move" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"${new_status}\"}")

  local title
  title=$(echo "$result" | python3 -c "import sys, json; print(json.load(sys.stdin)['title'])" 2>/dev/null || echo "Task")

  echo -e "${GREEN}✓ Moved:${NC} ${title} → $(status_icon "$new_status") ${new_status}"
}

cmd_delete() {
  local id="$1"
  curl -s -X DELETE "${API}/tasks/${id}" > /dev/null
  echo -e "${GREEN}✓ Task deleted${NC}"
}

cmd_stats() {
  curl -s "${API}/stats" | python3 -c "
import sys, json
s = json.load(sys.stdin)
print(f'  📊 Total: {s[\"total\"]} tasks')
print()
bs = s['byStatus']
print(f'  📋 Backlog:     {bs[\"backlog\"]}')
print(f'  📝 To Do:       {bs[\"todo\"]}')
print(f'  ⚡ In Progress: {bs[\"in_progress\"]}')
print(f'  🔍 Review:      {bs[\"review\"]}')
print(f'  ✅ Done:        {bs[\"done\"]}')
print()
bp = s['byPriority']
print(f'  🔴 Critical: {bp[\"critical\"]}  🟡 High: {bp[\"high\"]}  🔵 Medium: {bp[\"medium\"]}  🟢 Low: {bp[\"low\"]}')
print(f'  ⏰ Done (24h): {s[\"recentlyCompleted\"]}')
"
}

cmd_search() {
  local query="$1"
  curl -s "${API}/tasks?search=${query}" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
if not tasks:
    print('  No results found.')
    sys.exit(0)
print(f'  Found {len(tasks)} result(s):')
print()
for t in tasks:
    print(f'  [{t[\"priority\"].upper():8s}] {t[\"title\"]}')
    print(f'           {t[\"status\"]} | {t[\"id\"][:8]}...')
    print()
"
}

cmd_clear_done() {
  local result
  result=$(curl -s -X DELETE "${API}/tasks?status=done")
  local count
  count=$(echo "$result" | python3 -c "import sys, json; print(json.load(sys.stdin)['deleted'])")
  echo -e "${GREEN}✓ Cleared ${count} completed task(s)${NC}"
}

cmd_board() {
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  🦞 OpenClaw Kanban Board${NC}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo

  for status in backlog todo in_progress review done; do
    local icon
    icon=$(status_icon "$status")
    local label
    case "$status" in
      backlog)     label="BACKLOG" ;;
      todo)        label="TO DO" ;;
      in_progress) label="IN PROGRESS" ;;
      review)      label="REVIEW" ;;
      done)        label="DONE" ;;
    esac

    local tasks
    tasks=$(curl -s "${API}/tasks?status=${status}")
    local count
    count=$(echo "$tasks" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))")

    echo -e "${BOLD}${icon} ${label} (${count})${NC}"
    echo -e "───────────────────────────────────────"

    echo "$tasks" | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
if not tasks:
    print('  (empty)')
else:
    for t in tasks:
        p = t['priority'][0].upper()
        colors = {'C': '🔴', 'H': '🟡', 'M': '🔵', 'L': '🟢'}
        icon = colors.get(p, '⚪')
        a = t.get('assignee', '?')
        print(f'  {icon} {t[\"title\"]}')
        print(f'     └─ {a} | {t[\"id\"][:8]}...')
"
    echo
  done
}

cmd_help() {
  echo -e "${BOLD}🦞 OpenClaw Kanban CLI${NC}"
  echo
  echo "Usage: kanban-cli.sh <command> [args...]"
  echo
  echo "Commands:"
  echo "  list [status]              List tasks (backlog|todo|in_progress|review|done)"
  echo "  get <id>                   Get task details"
  echo "  add <title> [options]      Create a task"
  echo "  update <id> <json>         Update a task"
  echo "  move <id> <status>         Move to new column"
  echo "  delete <id>                Delete a task"
  echo "  stats                      Board statistics"
  echo "  search <query>             Search tasks"
  echo "  clear-done                 Remove completed tasks"
  echo "  board                      Show full board"
  echo
  echo "Add options:"
  echo "  --priority|-p <low|medium|high|critical>"
  echo "  --status|-s <backlog|todo|in_progress|review|done>"
  echo "  --assignee|-a <name>"
  echo "  --description|-d <text>"
  echo "  --tags|-t <comma,separated>"
  echo
  echo "Environment:"
  echo "  KANBAN_URL  Base URL (default: http://localhost:3000)"
}

# Main command dispatch
case "${1:-help}" in
  list)       cmd_list "${2:-}" ;;
  get)        cmd_get "$2" ;;
  add)        shift; cmd_add "$@" ;;
  update)     cmd_update "$2" "$3" ;;
  move)       cmd_move "$2" "$3" ;;
  delete)     cmd_delete "$2" ;;
  stats)      cmd_stats ;;
  search)     cmd_search "$2" ;;
  clear-done) cmd_clear_done ;;
  board)      cmd_board ;;
  help|--help|-h) cmd_help ;;
  *)          echo "Unknown command: $1"; cmd_help; exit 1 ;;
esac
