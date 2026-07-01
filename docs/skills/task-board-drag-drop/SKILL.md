---
name: task-board-drag-drop
description: "Add HTML5 drag-and-drop to the OpenReply Tasks board so users can move tasks between columns. Use when the user asks for drag-and-drop, kanban moves, or reordering tasks."
trigger: "drag and drop tasks | task board drag | move task columns | kanban tasks"
---

# task-board-drag-drop

Add drag-and-drop moves to the Tasks board in `app-tauri/src/or/dynamic.js`.

## What is supported today

The backend task model (`src/openreply/reply/tasks.py`) has `status: todo | in_progress | done` but no `sort_order`. Therefore drag-and-drop can move tasks **between columns** (change status). Reordering within a column requires backend schema changes.

## Markup

Task card must be draggable and expose its id:

```html
<div class="${card} !p-4 cursor-grab active:cursor-grabbing" draggable="true" data-task-id="${esc(t.id)}">
  ...
</div>
```

Column wrapper exposes the target status; inner dropzone is the visual target:

```html
<div data-status="${esc(st)}">
  <div class="mb-2 ...">${label} <span>${list.length}</span></div>
  <div class="tk-dropzone min-h-[120px] space-y-3 rounded-lg p-1 transition-colors">${cards}</div>
</div>
```

## Wiring

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
    board().querySelectorAll(".tk-dropzone").forEach((dz) =>
      dz.classList.remove("bg-reddit/10", "ring-2", "ring-reddit/30"));
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
    // Optimistic local move, then persist and reload from the server.
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

## UX notes

- `cursor-grab` / `active:cursor-grabbing` gives affordance.
- `opacity-50` on the dragged card makes it clear something is moving.
- `bg-reddit/10` + `ring-2 ring-reddit/30` on the dropzone shows a valid drop target.
- Optimistically update and re-render before the API call so the board feels instant.
- On failure, reload from the server to revert.

## Files involved

- `app-tauri/src/or/dynamic.js` — `renderTasks()`
- `app-tauri/src/or/api.js` — `api.taskUpdate(id, { status })`
- `src/openreply/reply/tasks.py` — backend task model

## To add within-column reordering

1. Add an integer `sort_order` column to `reply_tasks` in `schema.py`.
2. Update `create_task` to set a default order.
3. Update `update_task` to accept `sort_order`.
4. Update `list_tasks` to `order_by="sort_order, created_at desc"`.
5. On drop, compute the new position relative to sibling cards and call `api.taskUpdate(id, { sort_order: newOrder })`.
