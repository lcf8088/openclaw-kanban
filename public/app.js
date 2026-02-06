(function() {
  'use strict';

  // ============================================================================
  // STATE
  // ============================================================================
  const state = {
    tasks: [],
    filters: { search: '', priority: '', assignee: '' },
    editingTaskId: null,
    ws: null,
    connected: false,
    draggedTaskId: null,
    reconnectAttempts: 0
  };

  // ============================================================================
  // UTILITIES
  // ============================================================================

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function timeAgo(dateString) {
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;

    const years = Math.floor(months / 12);
    return `${years}y ago`;
  }

  function isActiveNow(task) {
    const lastUpdate = new Date(task.updated_at);
    const now = new Date();
    const minutesAgo = (now - lastUpdate) / 1000 / 60;
    return minutesAgo < 2;
  }

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  function showToast(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  // ============================================================================
  // API LAYER
  // ============================================================================

  const api = {
    baseUrl: '/api',

    async getTasks(filters = {}) {
      try {
        const params = new URLSearchParams();
        if (filters.status) params.append('status', filters.status);
        if (filters.priority) params.append('priority', filters.priority);
        if (filters.search) params.append('search', filters.search);
        if (filters.assignee) params.append('assignee', filters.assignee);

        const url = `${this.baseUrl}/tasks${params.toString() ? '?' + params.toString() : ''}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        showToast(`Failed to fetch tasks: ${error.message}`, 'error');
        throw error;
      }
    },

    async getTask(id) {
      try {
        const response = await fetch(`${this.baseUrl}/tasks/${id}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        showToast(`Failed to fetch task: ${error.message}`, 'error');
        throw error;
      }
    },

    async createTask(data) {
      try {
        const response = await fetch(`${this.baseUrl}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        showToast(`Failed to create task: ${error.message}`, 'error');
        throw error;
      }
    },

    async updateTask(id, data) {
      try {
        const response = await fetch(`${this.baseUrl}/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        showToast(`Failed to update task: ${error.message}`, 'error');
        throw error;
      }
    },

    async deleteTask(id) {
      try {
        const response = await fetch(`${this.baseUrl}/tasks/${id}`, {
          method: 'DELETE'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return true;
      } catch (error) {
        showToast(`Failed to delete task: ${error.message}`, 'error');
        throw error;
      }
    },

    async moveTask(id, status, order) {
      try {
        const response = await fetch(`${this.baseUrl}/tasks/${id}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, order })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        showToast(`Failed to move task: ${error.message}`, 'error');
        throw error;
      }
    },

    async getStats() {
      try {
        const response = await fetch(`${this.baseUrl}/stats`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        showToast(`Failed to fetch stats: ${error.message}`, 'error');
        throw error;
      }
    },

    async clearDone() {
      try {
        const response = await fetch(`${this.baseUrl}/tasks?status=done`, {
          method: 'DELETE'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        showToast(`Failed to clear done tasks: ${error.message}`, 'error');
        throw error;
      }
    }
  };

  // ============================================================================
  // WEBSOCKET
  // ============================================================================

  function connectWebSocket() {
    const wsUrl = `ws://${window.location.host}`;

    try {
      state.ws = new WebSocket(wsUrl);

      state.ws.onopen = () => {
        state.connected = true;
        state.reconnectAttempts = 0;
        updateConnectionStatus();
        showToast('Connected to server', 'success');
      };

      state.ws.onclose = () => {
        state.connected = false;
        updateConnectionStatus();
        showToast('Disconnected from server', 'warning');
        scheduleReconnect();
      };

      state.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      state.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    state.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
    setTimeout(() => {
      console.log(`Attempting to reconnect (attempt ${state.reconnectAttempts})...`);
      connectWebSocket();
    }, delay);
  }

  function handleWebSocketMessage(message) {
    const { type, task } = message;

    switch (type) {
      case 'task_created':
        if (task && !state.tasks.find(t => t.id === task.id)) {
          state.tasks.push(task);
          renderBoard();
        }
        break;

      case 'task_updated':
      case 'task_moved':
        if (task) {
          const index = state.tasks.findIndex(t => t.id === task.id);
          if (index !== -1) {
            state.tasks[index] = task;
            renderBoard();
          }
        }
        break;

      case 'task_deleted':
        if (task && task.id) {
          state.tasks = state.tasks.filter(t => t.id !== task.id);
          renderBoard();
        }
        break;

      default:
        console.log('Unknown WebSocket message type:', type);
    }
  }

  function updateConnectionStatus() {
    const statusEl = document.getElementById('connectionStatus');
    if (state.connected) {
      statusEl.textContent = '● Connected';
      statusEl.style.color = '#4ade80';
    } else {
      statusEl.textContent = '● Disconnected';
      statusEl.style.color = '#f87171';
    }
  }

  // ============================================================================
  // RENDERING
  // ============================================================================

  function filterTasks() {
    return state.tasks.filter(task => {
      // Search filter
      if (state.filters.search) {
        const search = state.filters.search.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(search);
        const matchesDesc = task.description?.toLowerCase().includes(search);
        if (!matchesTitle && !matchesDesc) return false;
      }

      // Priority filter
      if (state.filters.priority && task.priority !== state.filters.priority) {
        return false;
      }

      // Assignee filter
      if (state.filters.assignee && task.assignee !== state.filters.assignee) {
        return false;
      }

      return true;
    });
  }

  function renderCard(task) {
    const isActive = isActiveNow(task);
    const tags = task.tags || [];
    const tagsHtml = tags.map(tag =>
      `<span class="tag">${escapeHtml(tag)}</span>`
    ).join('');

    return `
      <div class="task-card${isActive ? ' active-now' : ''}"
           draggable="true"
           data-task-id="${escapeHtml(task.id)}"
           data-priority="${escapeHtml(task.priority)}">
        <div class="card-header">
          ${isActive ? '<span class="active-badge">⚡️ Active</span>' : ''}
          <span class="priority-badge priority-${escapeHtml(task.priority)}">
            ${escapeHtml(task.priority)}
          </span>
          <span class="card-assignee">${escapeHtml(task.assignee || 'Unassigned')}</span>
        </div>
        <h4 class="card-title">${escapeHtml(task.title)}</h4>
        <p class="card-description">${escapeHtml(task.description || '')}</p>
        <div class="card-footer">
          <div class="card-tags">${tagsHtml}</div>
          <span class="card-time">${timeAgo(task.created_at)}</span>
        </div>
      </div>
    `;
  }

  function renderBoard() {
    const filteredTasks = filterTasks();

    // Group tasks by status
    const tasksByStatus = {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: []
    };

    filteredTasks.forEach(task => {
      if (tasksByStatus[task.status]) {
        tasksByStatus[task.status].push(task);
      }
    });

    // Sort tasks within each group by order
    Object.keys(tasksByStatus).forEach(status => {
      tasksByStatus[status].sort((a, b) => (a.order || 0) - (b.order || 0));
    });

    // Render each column
    Object.keys(tasksByStatus).forEach(status => {
      const columnBody = document.querySelector(`.column-body[data-status="${status}"]`);
      const tasks = tasksByStatus[status];

      if (tasks.length === 0) {
        columnBody.innerHTML = '<div class="empty-column">No tasks</div>';
      } else {
        columnBody.innerHTML = tasks.map(renderCard).join('');
      }

      // Update count
      const countEl = document.getElementById(`count-${status}`);
      if (countEl) {
        countEl.textContent = tasks.length;
      }
    });

    updateStatsBar();
  }

  function updateStatsBar() {
    const total = state.tasks.length;
    const inProgress = state.tasks.filter(t => t.status === 'in_progress').length;

    // Calculate tasks done today
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const doneToday = state.tasks.filter(t => {
      return t.status === 'done' && new Date(t.updated_at) > oneDayAgo;
    }).length;

    const statsBar = document.getElementById('statsBar');
    statsBar.innerHTML = `
      <span class="stat">📊 ${total} tasks</span>
      <span class="stat">⚡ ${inProgress} active</span>
      <span class="stat">✅ ${doneToday} done today</span>
    `;
  }

  // ============================================================================
  // DRAG AND DROP
  // ============================================================================

  function handleDragStart(e) {
    const card = e.target.closest('.task-card');
    if (!card) return;

    state.draggedTaskId = card.dataset.taskId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.draggedTaskId);
  }

  function handleDragEnd(e) {
    const card = e.target.closest('.task-card');
    if (card) {
      card.classList.remove('dragging');
    }

    // Clean up all drag-over indicators
    document.querySelectorAll('.column-body').forEach(col => {
      col.classList.remove('drag-over');
    });

    state.draggedTaskId = null;
  }

  function handleDragOver(e) {
    e.preventDefault();
    const columnBody = e.target.closest('.column-body');
    if (!columnBody) return;

    columnBody.classList.add('drag-over');
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDragLeave(e) {
    const columnBody = e.target.closest('.column-body');
    if (!columnBody) return;

    // Only remove if we're actually leaving the column body
    if (e.target === columnBody && !columnBody.contains(e.relatedTarget)) {
      columnBody.classList.remove('drag-over');
    }
  }

  async function handleDrop(e) {
    e.preventDefault();

    const columnBody = e.target.closest('.column-body');
    if (!columnBody) return;

    columnBody.classList.remove('drag-over');

    const taskId = e.dataTransfer.getData('text/plain');
    const newStatus = columnBody.dataset.status;

    if (!taskId || !newStatus) return;

    // Calculate drop position
    const cards = Array.from(columnBody.querySelectorAll('.task-card:not(.dragging)'));
    const mouseY = e.clientY;

    let insertIndex = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (mouseY < rect.top + rect.height / 2) {
        insertIndex = i;
        break;
      }
    }

    try {
      await api.moveTask(taskId, newStatus, insertIndex);
      await fetchAndRender();
    } catch (error) {
      console.error('Failed to move task:', error);
    }
  }

  // ============================================================================
  // MODALS
  // ============================================================================

  function openNewTaskModal() {
    state.editingTaskId = null;

    // Reset form
    document.getElementById('taskForm').reset();
    document.getElementById('taskStatus').value = 'backlog';
    document.getElementById('taskPriority').value = 'medium';

    // Update modal UI
    document.getElementById('modalTitle').textContent = 'New Task';
    document.getElementById('modalSubmit').textContent = 'Create Task';

    showModal('taskModal');
  }

  async function openEditTaskModal(taskId) {
    state.editingTaskId = taskId;

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) {
      showToast('Task not found', 'error');
      return;
    }

    // Populate form
    document.getElementById('taskTitle').value = task.title || '';
    document.getElementById('taskDescription').value = task.description || '';
    document.getElementById('taskStatus').value = task.status || 'backlog';
    document.getElementById('taskPriority').value = task.priority || 'medium';
    document.getElementById('taskAssignee').value = task.assignee || '';
    document.getElementById('taskTags').value = (task.tags || []).join(', ');

    // Update modal UI
    document.getElementById('modalTitle').textContent = 'Edit Task';
    document.getElementById('modalSubmit').textContent = 'Save Changes';

    closeModal('detailModal');
    showModal('taskModal');
  }

  function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
    }
  }

  async function handleTaskFormSubmit(e) {
    e.preventDefault();

    const formData = {
      title: document.getElementById('taskTitle').value.trim(),
      description: document.getElementById('taskDescription').value.trim(),
      status: document.getElementById('taskStatus').value,
      priority: document.getElementById('taskPriority').value,
      assignee: document.getElementById('taskAssignee').value,
      tags: document.getElementById('taskTags').value
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
    };

    if (!formData.title) {
      showToast('Title is required', 'error');
      return;
    }

    try {
      if (state.editingTaskId) {
        await api.updateTask(state.editingTaskId, formData);
        showToast('Task updated successfully', 'success');
      } else {
        await api.createTask(formData);
        showToast('Task created successfully', 'success');
      }

      closeModal('taskModal');
      await fetchAndRender();
    } catch (error) {
      console.error('Failed to save task:', error);
    }
  }

  // ============================================================================
  // TASK DETAIL VIEW
  // ============================================================================

  function openTaskDetail(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) {
      showToast('Task not found', 'error');
      return;
    }

    document.getElementById('detailTitle').textContent = task.title;

    const tags = task.tags || [];
    const tagsHtml = tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');

    const detailBody = document.getElementById('detailBody');
    detailBody.innerHTML = `
      <div class="detail-section">
        <label>Description</label>
        <p>${escapeHtml(task.description || 'No description provided')}</p>
      </div>
      <div class="detail-row">
        <div class="detail-section">
          <label>Status</label>
          <p><span class="status-badge status-${escapeHtml(task.status)}">${escapeHtml(task.status)}</span></p>
        </div>
        <div class="detail-section">
          <label>Priority</label>
          <p><span class="priority-badge priority-${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span></p>
        </div>
      </div>
      <div class="detail-row">
        <div class="detail-section">
          <label>Assignee</label>
          <p>${escapeHtml(task.assignee || 'Unassigned')}</p>
        </div>
        <div class="detail-section">
          <label>Tags</label>
          <div class="card-tags">${tagsHtml || '<span class="text-muted">No tags</span>'}</div>
        </div>
      </div>
      <div class="detail-row">
        <div class="detail-section">
          <label>Created</label>
          <p>${new Date(task.created_at).toLocaleString()}</p>
        </div>
        <div class="detail-section">
          <label>Updated</label>
          <p>${new Date(task.updated_at).toLocaleString()}</p>
        </div>
      </div>
    `;

    // Store task ID for edit/delete actions
    detailBody.dataset.taskId = task.id;

    showModal('detailModal');
  }

  async function handleDeleteTask() {
    const detailBody = document.getElementById('detailBody');
    const taskId = detailBody.dataset.taskId;

    if (!taskId) return;

    if (!confirm('Delete this task? This action cannot be undone.')) {
      return;
    }

    try {
      await api.deleteTask(taskId);
      showToast('Task deleted successfully', 'success');
      closeModal('detailModal');
      await fetchAndRender();
    } catch (error) {
      console.error('Failed to delete task:', error);
    }
  }

  function handleEditFromDetail() {
    const detailBody = document.getElementById('detailBody');
    const taskId = detailBody.dataset.taskId;

    if (taskId) {
      openEditTaskModal(taskId);
    }
  }

  // ============================================================================
  // FILTERS AND SEARCH
  // ============================================================================

  const handleSearchInput = debounce((e) => {
    state.filters.search = e.target.value.trim();
    renderBoard();
  }, 300);

  function handlePriorityFilter(e) {
    state.filters.priority = e.target.value;
    renderBoard();
  }

  function handleAssigneeFilter(e) {
    state.filters.assignee = e.target.value;
    renderBoard();
  }

  // ============================================================================
  // CLEAR DONE
  // ============================================================================

  async function handleClearDone() {
    if (!confirm('Clear all completed tasks? This action cannot be undone.')) {
      return;
    }

    try {
      await api.clearDone();
      showToast('Completed tasks cleared', 'success');
      await fetchAndRender();
    } catch (error) {
      console.error('Failed to clear done tasks:', error);
    }
  }

  // ============================================================================
  // THEME TOGGLE
  // ============================================================================

  function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  }

  // ============================================================================
  // KEYBOARD SHORTCUTS
  // ============================================================================

  function handleKeyboardShortcuts(e) {
    // Escape - close modals
    if (e.key === 'Escape') {
      closeModal('taskModal');
      closeModal('detailModal');
      return;
    }

    // N - new task (when not focused on input and no modal is open)
    if (e.key === 'n' || e.key === 'N') {
      const activeModal = document.querySelector('.modal-overlay.active');
      const focusedInput = document.activeElement.tagName === 'INPUT' ||
                          document.activeElement.tagName === 'TEXTAREA' ||
                          document.activeElement.tagName === 'SELECT';

      if (!activeModal && !focusedInput) {
        openNewTaskModal();
      }
    }
  }

  // ============================================================================
  // EVENT BINDING
  // ============================================================================

  function bindEvents() {
    // Add task button
    document.getElementById('addTaskBtn').addEventListener('click', openNewTaskModal);

    // Task form
    document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);
    document.getElementById('modalCancel').addEventListener('click', () => closeModal('taskModal'));
    document.getElementById('modalClose').addEventListener('click', () => closeModal('taskModal'));

    // Detail modal
    document.getElementById('detailClose').addEventListener('click', () => closeModal('detailModal'));
    document.getElementById('detailEdit').addEventListener('click', handleEditFromDetail);
    document.getElementById('detailDelete').addEventListener('click', handleDeleteTask);

    // Filters and search
    document.getElementById('searchInput').addEventListener('input', handleSearchInput);
    document.getElementById('filterPriority').addEventListener('change', handlePriorityFilter);
    document.getElementById('filterAssignee').addEventListener('change', handleAssigneeFilter);

    // Clear done
    document.getElementById('clearDoneBtn').addEventListener('click', handleClearDone);

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Drag and drop - event delegation on board
    const board = document.getElementById('board');

    board.addEventListener('dragstart', handleDragStart);
    board.addEventListener('dragend', handleDragEnd);
    board.addEventListener('dragover', handleDragOver);
    board.addEventListener('dragleave', handleDragLeave);
    board.addEventListener('drop', handleDrop);

    // Card click for detail view - event delegation
    board.addEventListener('click', (e) => {
      const card = e.target.closest('.task-card');
      if (card && !card.classList.contains('dragging')) {
        const taskId = card.dataset.taskId;
        if (taskId) {
          openTaskDetail(taskId);
        }
      }
    });

    // Close modals when clicking overlay
    document.getElementById('taskModal').addEventListener('click', (e) => {
      if (e.target.id === 'taskModal') {
        closeModal('taskModal');
      }
    });

    document.getElementById('detailModal').addEventListener('click', (e) => {
      if (e.target.id === 'detailModal') {
        closeModal('detailModal');
      }
    });
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async function fetchAndRender() {
    try {
      const tasks = await api.getTasks();
      state.tasks = tasks;
      renderBoard();
    } catch (error) {
      console.error('Failed to fetch and render:', error);
    }
  }

  function init() {
    loadTheme();
    connectWebSocket();
    fetchAndRender();
    bindEvents();
  }

  // Start the app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
