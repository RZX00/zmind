// Shared containment reconcile (WS5-3). parentGroupId is the single source of truth
// for membership; children[] is the derived ordered view. Operates on a plain node
// list ({id, children?, parentGroupId?}) and mutates each entry in place so BOTH
// executors — applyCanvasOps (snapshot) and applyOpsToYDoc (live Y.Doc) — converge on
// the same invariant: single-parent, no self-parent, no dangling refs, declared order
// preserved. Idempotent on already-consistent input.
export const reconcileContainment = (nodes) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const containers = nodes.filter((n) => Array.isArray(n.children));

  // Clear self-parent and truly-dangling back-pointers.
  for (const n of nodes) {
    if (n.parentGroupId === n.id) delete n.parentGroupId;
    if (n.parentGroupId != null && !byId.has(n.parentGroupId)) delete n.parentGroupId;
  }

  // Pass 1: an explicit children[] entry with no parent yet adopts this container.
  // Node order => the first container to claim an orphan wins (single-parent).
  for (const c of containers) {
    for (const childId of c.children) {
      const child = byId.get(childId);
      if (!child || child.id === c.id) continue;
      if (child.parentGroupId == null) child.parentGroupId = c.id;
    }
  }

  // Break containment cycles deterministically so the graph is a forest and BOTH
  // executors heal to the SAME result (the live Y.Doc path cannot reject/rollback).
  // Pass 1 can itself create a cycle (A.children=[B] + B.children=[A]), so this runs
  // after it. Walk parentGroupId upward from each node; on the first revisit, sever the
  // back-pointer of the lexicographically-smallest id in the cycle — order-independent,
  // so both executors pick the same victim regardless of node iteration order.
  for (const start of nodes) {
    const path = [];
    const onPath = new Set();
    let cur = start;
    while (cur && cur.parentGroupId != null) {
      if (onPath.has(cur.id)) {
        const cycle = path.slice(path.indexOf(cur.id));
        const minId = cycle.reduce((m, x) => (String(x) < String(m) ? x : m), cycle[0]);
        const victim = byId.get(minId);
        if (victim) delete victim.parentGroupId;
        break;
      }
      onPath.add(cur.id);
      path.push(cur.id);
      cur = byId.get(cur.parentGroupId);
    }
  }

  // Pass 2: rebuild each children[] from parentGroupId truth — keep the declared order
  // for genuine members, drop stale/dangling ids, append missing back-refs, dedupe.
  for (const c of containers) {
    const kept = [];
    const keptSet = new Set();
    for (const id of c.children) {
      if (keptSet.has(id)) continue;
      const child = byId.get(id);
      if (child && child.id !== c.id && child.parentGroupId === c.id) {
        kept.push(id);
        keptSet.add(id);
      }
    }
    for (const n of nodes) {
      if (n.parentGroupId === c.id && n.id !== c.id && !keptSet.has(n.id)) {
        kept.push(n.id);
        keptSet.add(n.id);
      }
    }
    c.children = kept;
  }
};
