const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');

const app = express();
const PORT = 3000;
const TASKS_FILE = path.join(__dirname, 'data', 'tasks.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// In-memory task storage
let tasks = [];

// Valid enums
const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

// Load tasks from file
async function loadTasks() {
  try {
    const data = await fs.readFile(TASKS_FILE, 'utf8');
    tasks = JSON.parse(data);
    console.log(`Loaded ${tasks.length} tasks from storage`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing tasks file, starting with empty array');
      tasks = [];
      await saveTasks();
    } else {
      console.error('Error loading tasks:', error);
      tasks = [];
    }
  }
}

// Save tasks to file
async function saveTasks() {
  try {
    await fs.mkdir(path.dirname(TASKS_FILE), { recursive: true });
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving tasks:', error);
    throw error;
  }
}

// WebSocket broadcast
function broadcastToClients(message) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(JSON.stringify(message));
    }
  });
}

// Validation helpers
function validateTaskInput(data, isUpdate = false) {
  const errors = [];

  if (!isUpdate && !data.title) {
    errors.push('Title is required');
  }

  if (data.title !== undefined && typeof data.title !== 'string') {
    errors.push('Title must be a string');
  }

  if (data.title !== undefined && data.title.trim().length === 0) {
    errors.push('Title cannot be empty');
  }

  if (data.status !== undefined && !VALID_STATUSES.includes(data.status)) {
    errors.push(`Status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (data.priority !== undefined && !VALID_PRIORITIES.includes(data.priority)) {
    errors.push(`Priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }

  if (data.tags !== undefined && !Array.isArray(data.tags)) {
    errors.push('Tags must be an array');
  }

  if (data.tags !== undefined && !data.tags.every(tag => typeof tag === 'string')) {
    errors.push('All tags must be strings');
  }

  return errors;
}

// API Routes

// GET /api/tasks - List all tasks with filtering
app.get('/api/tasks', async (req, res) => {
  try {
    let filtered = [...tasks];

    // Filter by status
    if (req.query.status) {
      filtered = filtered.filter(task => task.status === req.query.status);
    }

    // Filter by priority
    if (req.query.priority) {
      filtered = filtered.filter(task => task.priority === req.query.priority);
    }

    // Filter by assignee
    if (req.query.assignee) {
      filtered = filtered.filter(task => task.assignee === req.query.assignee);
    }

    // Search in title and description
    if (req.query.search) {
      const searchLower = req.query.search.toLowerCase();
      filtered = filtered.filter(task =>
        task.title.toLowerCase().includes(searchLower) ||
        task.description.toLowerCase().includes(searchLower)
      );
    }

    // Sort by status order, then by order field
    const statusOrder = { backlog: 0, todo: 1, in_progress: 2, review: 3, done: 4 };
    filtered.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.order - b.order;
    });

    res.json(filtered);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/:id - Get single task
app.get('/api/tasks/:id', async (req, res) => {
  try {
    const task = tasks.find(t => t.id === req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks - Create new task
app.post('/api/tasks', async (req, res) => {
  try {
    const errors = validateTaskInput(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const now = new Date().toISOString();
    const newTask = {
      id: uuidv4(),
      title: req.body.title.trim(),
      description: req.body.description || '',
      status: req.body.status || 'backlog',
      priority: req.body.priority || 'medium',
      tags: req.body.tags || [],
      assignee: req.body.assignee || '',
      created_at: now,
      updated_at: now,
      order: req.body.order !== undefined ? req.body.order : 0
    };

    tasks.push(newTask);
    await saveTasks();

    broadcastToClients({
      type: 'task_created',
      task: newTask,
      timestamp: now
    });

    res.status(201).json(newTask);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/tasks/:id - Update task
app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const taskIndex = tasks.findIndex(t => t.id === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const errors = validateTaskInput(req.body, true);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    const updatedTask = {
      ...tasks[taskIndex],
      ...req.body,
      id: tasks[taskIndex].id, // Prevent ID change
      created_at: tasks[taskIndex].created_at, // Prevent created_at change
      updated_at: new Date().toISOString()
    };

    // Trim title if provided
    if (req.body.title !== undefined) {
      updatedTask.title = req.body.title.trim();
    }

    tasks[taskIndex] = updatedTask;
    await saveTasks();

    broadcastToClients({
      type: 'task_updated',
      task: updatedTask,
      timestamp: updatedTask.updated_at
    });

    res.json(updatedTask);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tasks/:id - Delete task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const taskIndex = tasks.findIndex(t => t.id === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const deletedTask = tasks[taskIndex];
    tasks.splice(taskIndex, 1);
    await saveTasks();

    broadcastToClients({
      type: 'task_deleted',
      task: deletedTask,
      timestamp: new Date().toISOString()
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/:id/move - Move task to new column
app.post('/api/tasks/:id/move', async (req, res) => {
  try {
    const taskIndex = tasks.findIndex(t => t.id === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!req.body.status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    if (!VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const updatedTask = {
      ...tasks[taskIndex],
      status: req.body.status,
      order: req.body.order !== undefined ? req.body.order : tasks[taskIndex].order,
      updated_at: new Date().toISOString()
    };

    tasks[taskIndex] = updatedTask;
    await saveTasks();

    broadcastToClients({
      type: 'task_moved',
      task: updatedTask,
      timestamp: updatedTask.updated_at
    });

    res.json(updatedTask);
  } catch (error) {
    console.error('Error moving task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/stats - Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    const byStatus = {
      backlog: 0,
      todo: 0,
      in_progress: 0,
      review: 0,
      done: 0
    };

    const byPriority = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let recentlyCompleted = 0;

    tasks.forEach(task => {
      byStatus[task.status]++;
      byPriority[task.priority]++;

      if (task.status === 'done' && task.updated_at >= oneDayAgo) {
        recentlyCompleted++;
      }
    });

    res.json({
      total: tasks.length,
      byStatus,
      byPriority,
      recentlyCompleted
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/bulk - Bulk create tasks
app.post('/api/tasks/bulk', async (req, res) => {
  try {
    if (!req.body.tasks || !Array.isArray(req.body.tasks)) {
      return res.status(400).json({ error: 'Body must contain a "tasks" array' });
    }

    const createdTasks = [];
    const errors = [];

    for (let i = 0; i < req.body.tasks.length; i++) {
      const taskData = req.body.tasks[i];
      const validationErrors = validateTaskInput(taskData);

      if (validationErrors.length > 0) {
        errors.push(`Task ${i}: ${validationErrors.join('; ')}`);
        continue;
      }

      const now = new Date().toISOString();
      const newTask = {
        id: uuidv4(),
        title: taskData.title.trim(),
        description: taskData.description || '',
        status: taskData.status || 'backlog',
        priority: taskData.priority || 'medium',
        tags: taskData.tags || [],
        assignee: taskData.assignee || '',
        created_at: now,
        updated_at: now,
        order: taskData.order !== undefined ? taskData.order : 0
      };

      tasks.push(newTask);
      createdTasks.push(newTask);
    }

    if (errors.length > 0 && createdTasks.length === 0) {
      return res.status(400).json({ error: errors.join('; ') });
    }

    await saveTasks();

    // Broadcast each created task
    createdTasks.forEach(task => {
      broadcastToClients({
        type: 'task_created',
        task,
        timestamp: task.created_at
      });
    });

    const response = { tasks: createdTasks };
    if (errors.length > 0) {
      response.errors = errors;
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Error bulk creating tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tasks?status=done - Clear done tasks
app.delete('/api/tasks', async (req, res) => {
  try {
    if (req.query.status !== 'done') {
      return res.status(400).json({ error: 'Only status=done is supported for bulk delete' });
    }

    const initialCount = tasks.length;
    const deletedTasks = tasks.filter(t => t.status === 'done');
    tasks = tasks.filter(t => t.status !== 'done');
    const deletedCount = initialCount - tasks.length;

    await saveTasks();

    // Broadcast deletion for each task
    deletedTasks.forEach(task => {
      broadcastToClients({
        type: 'task_deleted',
        task,
        timestamp: new Date().toISOString()
      });
    });

    res.json({ deleted: deletedCount });
  } catch (error) {
    console.error('Error clearing done tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling for invalid JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next();
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Create HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Initialize and start server
async function start() {
  try {
    await loadTasks();
    server.listen(PORT, () => {
      console.log(`OpenClaw Kanban running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
