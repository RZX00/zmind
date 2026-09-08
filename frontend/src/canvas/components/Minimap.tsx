import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { useCanvasNodes, useCanvasConnections, useSelectedNodeIds, useViewTransform, useViewportSize } from '../hooks/useCanvasSelector';
import { calculateCanvasBounds } from './core/systems/CoordinateSystem';
import { minimapWorkerService, type MinimapGeometry } from '../services/minimap-worker.service';

interface MinimapProps {
  width?: number;  // 逻辑CSS宽度（像素）
  height?: number; // 逻辑CSS高度（像素）
  onNavigate?: (center: { x: number; y: number }) => void;
}

/**
 * 小地图（简化几何层）
 * - 绘制AABB与轻量连接线
 * - 展示当前视口矩形
 * - 点击/拖拽定位
 */
const Minimap: React.FC<MinimapProps> = ({ width = 200, height = 140, onNavigate }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodes = useCanvasNodes();
  const connections = useCanvasConnections();
  const selectedNodeIds = useSelectedNodeIds() as Set<string>;
  const transform = useViewTransform();
  const viewport = useViewportSize();

  const dpr = Math.max(1, Math.min(2, (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)));
  const { resolvedTheme } = useTheme();
  const padding = 8; // 逻辑像素padding

  // 计算内容边界（不加大padding），空内容时给默认小范围
  const contentBounds = useMemo(() => {
    if (!nodes || nodes.length === 0) {
      return { minX: -500, minY: -350, maxX: 500, maxY: 350, width: 1000, height: 700 };
    }
    const b = calculateCanvasBounds(nodes as any, 0);
    return b;
  }, [nodes]);

  // 计算小地图映射参数
  const mapping = useMemo(() => {
    const cw = Math.max(1, Math.round(width * dpr));
    const ch = Math.max(1, Math.round(height * dpr));
    const pad = padding * dpr;
    const innerW = Math.max(1, cw - 2 * pad);
    const innerH = Math.max(1, ch - 2 * pad);

    const sw = Math.max(1, contentBounds.width);
    const sh = Math.max(1, contentBounds.height);
    const scale = Math.min(innerW / sw, innerH / sh);
    const offsetX = pad + (innerW - sw * scale) / 2 - contentBounds.minX * scale;
    const offsetY = pad + (innerH - sh * scale) / 2 - contentBounds.minY * scale;
    return { cw, ch, pad, innerW, innerH, scale, offsetX, offsetY };
  }, [width, height, dpr, contentBounds]);

  const toMini = useCallback((x: number, y: number) => {
    return {
      x: mapping.offsetX + x * mapping.scale,
      y: mapping.offsetY + y * mapping.scale
    };
  }, [mapping]);

  const toWorld = useCallback((mx: number, my: number) => {
    return {
      x: (mx - mapping.offsetX) / mapping.scale,
      y: (my - mapping.offsetY) / mapping.scale,
    };
  }, [mapping]);

  // 使用Worker预构建简化几何
  const [geometry, setGeometry] = useState<MinimapGeometry>({ rects: [], lines: [] });
  useEffect(() => {
    let cancelled = false;
    minimapWorkerService
      .buildGeometry(nodes, connections)
      .then((g) => { if (!cancelled) setGeometry(g); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [nodes, connections]);

  // 绘制函数
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { cw, ch, scale } = mapping;

    // 调整画布像素尺寸
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    // 清空背景
    ctx.clearRect(0, 0, cw, ch);

    // 背景面板（深浅色适配：使用 next-themes 的 resolvedTheme）
    const isDark = resolvedTheme === 'dark';
    ctx.fillStyle = isDark ? '#181a1b' : 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, 0, cw, ch);
    // 外边缘线：深色模式也使用深色线
    // 删除外边缘线

    // 绘制节点（AABB）
    const strokeW = Math.max(1, Math.floor(dpr));
    ctx.lineWidth = strokeW;
    for (const r of geometry.rects) {
      const x = Math.round(mapping.offsetX + r.x * mapping.scale);
      const y = Math.round(mapping.offsetY + r.y * mapping.scale);
      const w = Math.max(1, Math.round(r.width * mapping.scale));
      const h = Math.max(1, Math.round(r.height * mapping.scale));
      if (w < 1 && h < 1) continue; // LOD
      ctx.strokeStyle = isDark ? 'rgba(229, 231, 235, 0.5)' : 'rgba(100, 116, 139, 0.75)';
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
    }

    // 选中元素高亮
    if (selectedNodeIds && selectedNodeIds.size > 0) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)'; // blue-500
      ctx.lineWidth = Math.max(1, Math.floor(1.5 * dpr));
      for (const n of nodes) {
        if (!selectedNodeIds.has(n.id)) continue;
        const x = Math.round((mapping.offsetX + n.x * mapping.scale));
        const y = Math.round((mapping.offsetY + n.y * mapping.scale));
        const w = Math.max(1, Math.round(n.width * mapping.scale));
        const h = Math.max(1, Math.round(n.height * mapping.scale));
        if (w < 1 && h < 1) continue;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
      }
    }

    // 简化连线：中心点直线（成本低）
    ctx.lineWidth = Math.max(1, Math.floor(dpr));
    ctx.strokeStyle = isDark ? 'rgba(229,231,235,0.4)' : 'rgba(148, 163, 184, 0.7)'; // slate-400
    for (const ln of geometry.lines) {
      const a = toMini(ln.x1, ln.y1);
      const b = toMini(ln.x2, ln.y2);
      if (Math.hypot(b.x - a.x, b.y - a.y) * (1 / dpr) < 2) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 绘制当前视口矩形
    if (viewport.width > 0 && viewport.height > 0 && transform.scale > 0) {
      const worldX0 = -transform.positionX / transform.scale;
      const worldY0 = -transform.positionY / transform.scale;
      const worldW = viewport.width / transform.scale;
      const worldH = viewport.height / transform.scale;
      const tl = toMini(worldX0, worldY0);
      const br = toMini(worldX0 + worldW, worldY0 + worldH);
      const vx = Math.round(tl.x) + 0.5;
      const vy = Math.round(tl.y) + 0.5;
      const vw = Math.max(1, Math.round(br.x - tl.x) - 1);
      const vh = Math.max(1, Math.round(br.y - tl.y) - 1);
      // 外描边 + 内半透明遮罩
      ctx.strokeStyle = isDark ? '#8c8273' : 'rgba(59, 130, 246, 0.9)';
      ctx.lineWidth = Math.max(1, Math.floor(1.5 * dpr));
      ctx.strokeRect(vx, vy, vw, vh);
      ctx.fillStyle = isDark ? 'rgba(140,130,115,0.15)' : 'rgba(59, 130, 246, 0.08)';
      ctx.fillRect(vx, vy, vw, vh);
    }
  }, [canvasRef, mapping, geometry, nodes, selectedNodeIds, transform, viewport, dpr, width, height, toMini, resolvedTheme]);

  useEffect(() => {
    draw();
  }, [draw]);

  // 交互：点击/拖拽定位
  const draggingRef = useRef(false);
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // MVP: 禁用平移（拖拽）。仅支持点击定位一次。
    draggingRef.current = false;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr;
    const my = (e.clientY - rect.top) * dpr;
    const world = toWorld(mx, my);
    onNavigate?.({ x: world.x, y: world.y });
  };

  const handlePointerMove = () => {
    // MVP: 禁用拖拽平移
    return;
  };

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    // MVP：禁用缩放，阻止默认滚轮缩放行为
    e.preventDefault();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      style={{ width: `${width}px`, height: `${height}px`, display: 'block', cursor: 'crosshair' }}
    />
  );
};

export default Minimap;
