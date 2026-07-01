# Learnings — Drag-and-drop task board

**Date:** 2026-06-30
**Context:** Tasks board in `app-tauri/src/or/dynamic.js`, `renderTasks()`.

---

## Problem

Tasks could only be moved between columns (To-do / In progress / Done) by clicking the **Next** button. There was no drag-and-drop support, which users expect from a kanban-style board.

---

## Fix

Added native HTML5 drag-and-drop to task cards and column dropzones.

### Markup changes

Task cards are now draggable and carry the task id:

```html
<div class="${card} !p-4 cursor-grab active:cursor-grabbing" draggable="true" data-task-id="${esc(t.id)}" data-row="${esc(t.id)}">
  ...
</div>
```

Columns expose their status and have a dedicated dropzone:

```html
<div data-status="${esc(st)}">
  <div class="mb-2 ...">${label} <span class="...">${list.length}</span></div>
  <div class="tk-dropzone min-h-[120px] space-y-3 rounded-lg p-1 transition-colors">${cards}</div>
</div>
```

### Event wiring

```js
let draggedId = null;
board().querySelectorAll("[data-task-id]").forEach((card) => {
  card.addEventListener("dragstart", (e) => {
    draggedId = card.dataset.taskId;
    e.dataTransfer.setData("text/plain", card.dataset.taskId);
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("opacity-50");
  });
  card.addEventListener("dragend", () => {
    draggedId = null;
    card.classList.remove("opacity-50");
    board().querySelectorAll(".tk-dropzone").forEach((dz) => dz.classList.remove("bg-reddit/10", "ring-2", "ring-reddit/30"));
  });
});

board().querySelectorAll(".tk-dropzone").forEach((dz) => {
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dz.classList.add("bg-reddit/10", "ring-2", "ring-reddit/30");
  });
  dz.addEventListener("dragleave", () => {
    dz.classList.remove("bg-reddit/10", "ring-2", "ring-reddit/30");
  });
  dz.addEventListener("drop", async (e) => {
    e.preventDefault();
    dz.classList.remove("bg-reddit/10", "ring-2", "ring-reddit/30");
    const id = e.dataTransfer.getData("text/plain") || draggedId;
    const status = dz.closest("[data-status]")?.dataset.status;
    if (!id || !status) return;
    const t = tasks.find((x) => String(x.id) === id);
    if (!t || t.status === status) return;
    // Optimistically move locally, then persist and reload from the server.
    t.status = status;
    paint();
    try {
      await api.taskUpdate(id, { status });
      // Bust cached Tasks portals so other tabs / revisits see the new status.
      document.getElementById("main-content")?.querySelectorAll('div[data-hash="#/tasks"]').forEach((p) => delete p.dataset.loaded);
      load();
    }
    catch (err) { toast("Move failed: " + err); load(); }
  });
});
```

### Behavior

- Dragging a card dims it (`opacity-50`).
- Hovering over a column highlights the dropzone (`bg-reddit/10` + ring).
- Dropping updates the task status optimistically in the local array, re-renders, then persists via `api.taskUpdate(id, { status })`.
- If the backend update fails, the board reloads from the server so the UI reverts.

---

## Limitations

The backend (`src/openreply/reply/tasks.py`) does not store a `sort_order`, so drag-and-drop only changes **status/column**, not position within a column. Tasks within a column are still sorted newest-first by `created_at`.

To support reordering within a column, the schema and `update_task` would need a `sort_order` / `position` field, and `list_tasks` would need to order by it.

---

## Files changed

- `app-tauri/src/or/dynamic.js` — `renderTasks()` task card markup and `paint()` drag-and-drop handlers
