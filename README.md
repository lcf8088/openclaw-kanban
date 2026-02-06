# OpenClaw Kanban Board

A production-ready Kanban board backend designed for OpenClaw AI agent task tracking with human monitoring capabilities.

## Features

- ✅ Full REST API for task management
- ✅ Real-time WebSocket updates
- ✅ Task filtering, search, and statistics
- ✅ Bulk operations support
- ✅ Persistent JSON storage
- ✅ Production-quality error handling
- ✅ Request logging
- ✅ CORS enabled for development

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Development mode with auto-reload
npm run dev
```

Server runs at: **http://localhost:3000**

## API Reference

### Task Model

```typescript
{
  id: string,              // UUID v4 (auto-generated)
  title: string,           // Required
  description: string,     // Default: ""
  status: string,          // "backlog" | "todo" | "in_progress" | "review" | "done"
  priority: string,        // "low" | "medium" | "high" | "critical"
  tags: string[],          // Default: []
  assignee: string,        // Default: ""
  created_at: string,      // ISO8601 timestamp (auto-generated)
  updated_at: string,      // ISO8601 timestamp (auto-updated)
  order: number            // Position within column (default: 0)
}
```

### Endpoints

#### GET `/api/tasks`
List all tasks with optional filtering.

**Query Parameters:**
- `status` - Filter by status (backlog, todo, in_progress, review, done)
- `priority` - Filter by priority (low, medium, high, critical)
- `assignee` - Filter by assignee name
- `search` - Search in title and description (case-insensitive)

**Example:**
```bash
curl "http://localhost:3000/api/tasks?status=in_progress&priority=high"
```

**Response:** `200 OK` - Array of tasks sorted by status then order

---

#### GET `/api/tasks/:id`
Get a single task by ID.

**Example:**
```bash
curl "http://localhost:3000/api/tasks/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
```

**Response:**
- `200 OK` - Task object
- `404 Not Found` - Task doesn't exist

---

#### POST `/api/tasks`
Create a new task.

**Request Body:**
```json
{
  "title": "Process incoming messages",
  "description": "Handle WhatsApp messages",
  "status": "todo",
  "priority": "high",
  "tags": ["communication", "automation"],
  "assignee": "OpenClaw"
}
```

**Required:** `title`
**Defaults:** status="backlog", priority="medium", tags=[], assignee="", description=""

**Example:**
```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"New task","priority":"high"}'
```

**Response:** `201 Created` - Created task with auto-generated id, timestamps

---

#### PATCH `/api/tasks/:id`
Update task fields.

**Request Body:** Partial task object (only fields to update)

**Example:**
```bash
curl -X PATCH http://localhost:3000/api/tasks/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d \
  -H "Content-Type: application/json" \
  -d '{"priority":"critical","tags":["urgent"]}'
```

**Response:**
- `200 OK` - Updated task
- `404 Not Found` - Task doesn't exist
- `400 Bad Request` - Validation error

**Note:** `updated_at` is automatically refreshed

---

#### DELETE `/api/tasks/:id`
Delete a task.

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/tasks/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
```

**Response:**
- `204 No Content` - Successfully deleted
- `404 Not Found` - Task doesn't exist

---

#### POST `/api/tasks/:id/move`
Move a task to a new column/status.

**Request Body:**
```json
{
  "status": "in_progress",
  "order": 2
}
```

**Required:** `status`

**Example:**
```bash
curl -X POST http://localhost:3000/api/tasks/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/move \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'
```

**Response:**
- `200 OK` - Updated task
- `404 Not Found` - Task doesn't exist
- `400 Bad Request` - Invalid status

---

#### GET `/api/stats`
Get task statistics.

**Example:**
```bash
curl http://localhost:3000/api/stats
```

**Response:** `200 OK`
```json
{
  "total": 6,
  "byStatus": {
    "backlog": 1,
    "todo": 1,
    "in_progress": 2,
    "review": 1,
    "done": 1
  },
  "byPriority": {
    "low": 1,
    "medium": 2,
    "high": 2,
    "critical": 1
  },
  "recentlyCompleted": 3
}
```

**Note:** `recentlyCompleted` counts tasks completed in the last 24 hours

---

#### POST `/api/tasks/bulk`
Bulk create multiple tasks.

**Request Body:**
```json
{
  "tasks": [
    {"title": "Task 1", "priority": "high"},
    {"title": "Task 2", "status": "todo"},
    {"title": "Task 3", "assignee": "OpenClaw"}
  ]
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/tasks/bulk \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"title":"Task 1"},{"title":"Task 2"}]}'
```

**Response:** `201 Created`
```json
{
  "tasks": [...],
  "errors": ["Task 2: Title cannot be empty"]
}
```

**Note:** Partial success is possible. Valid tasks are created even if some fail validation.

---

#### DELETE `/api/tasks?status=done`
Clear all completed tasks.

**Example:**
```bash
curl -X DELETE "http://localhost:3000/api/tasks?status=done"
```

**Response:** `200 OK`
```json
{
  "deleted": 5
}
```

**Note:** Only `status=done` is supported for bulk delete.

---

## WebSocket API

Connect to receive real-time task updates.

**Endpoint:** `ws://localhost:3000`

**Message Format:**
```json
{
  "type": "task_created" | "task_updated" | "task_deleted" | "task_moved",
  "task": { /* task object */ },
  "timestamp": "2026-02-06T16:41:15.591Z"
}
```

**Example (JavaScript):**
```javascript
const ws = new WebSocket('ws://localhost:3000');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log(`Task ${message.type}:`, message.task);
};
```

**Events:**
- `task_created` - New task created
- `task_updated` - Task fields updated
- `task_deleted` - Task removed
- `task_moved` - Task moved to different column

---

## Error Handling

All endpoints return consistent error responses:

**400 Bad Request:**
```json
{
  "error": "Title is required"
}
```

**404 Not Found:**
```json
{
  "error": "Task not found"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Internal server error"
}
```

---

## Storage

Tasks are persisted to `data/tasks.json` with pretty formatting (2-space indentation).

**Initial Seed Data:**
- 6 example tasks covering all statuses
- Realistic OpenClaw scenarios
- Demonstrates priority levels and assignees

---

## Project Structure

```
openclaw-kanban/
├── server.js           # Express server with WebSocket support
├── package.json        # Dependencies and scripts
├── data/
│   └── tasks.json      # Persistent task storage
└── public/             # Static frontend files
```

---

## Development

**Console Logging:**
All API requests are logged with method, path, status code, and duration:
```
GET /api/tasks 200 - 5ms
POST /api/tasks 201 - 12ms
PATCH /api/tasks/abc123 200 - 8ms
```

**Hot Reload:**
```bash
npm run dev
```

---

## Production Considerations

✅ **Implemented:**
- Input validation with detailed error messages
- Automatic timestamp management
- Data persistence with atomic writes
- WebSocket error handling
- Request logging
- CORS support

⚠️ **Future Enhancements:**
- Add authentication/authorization
- Implement rate limiting
- Add database backend (PostgreSQL/MongoDB)
- Add task assignment notifications
- Implement task due dates and reminders
- Add file attachment support

---

## Example Workflow

```bash
# 1. Create a task
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Process emails","assignee":"OpenClaw","priority":"high"}'

# 2. Move to in_progress
curl -X POST http://localhost:3000/api/tasks/{id}/move \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'

# 3. Update with details
curl -X PATCH http://localhost:3000/api/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"description":"Processed 47 emails","tags":["completed"]}'

# 4. Mark as done
curl -X POST http://localhost:3000/api/tasks/{id}/move \
  -H "Content-Type: application/json" \
  -d '{"status":"done"}'

# 5. Check stats
curl http://localhost:3000/api/stats
```

---

## License

MIT

---

## Support

For issues or questions, please refer to the API documentation above or check the console logs for detailed error messages.
