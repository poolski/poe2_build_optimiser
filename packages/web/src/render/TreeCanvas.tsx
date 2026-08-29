// Adapted from poe2-build-planner src/render/TreeView.tsx (MIT -- see ./LICENSE.upstream).
// Kept: canvas ref + ResizeObserver + rAF-on-dirty loop + pointer pan + hover pick structure.
// Changed: draws our stylised renderer, renders a result diff (not an editable tree), and
// replaces upstream's min/max-jumping wheel zoom with a bounded log slider + fixed wheel step
// + +/-/fit buttons (docs/web-ui/06-tree-canvas.md "Fixes to make on the port").

import { useEffect, useMemo, useRef, useState } from "react";
import { drawTree } from "./draw";
import type { MinTree } from "./types";
import { buildSpatialIndex, nodeAt, type SpatialIndex } from "./spatialIndex";
import {
  clampScale,
  fitToBounds,
  scaleRange,
  screenToWorld,
  type Size,
  type Viewport,
} from "./viewport";
import { scaleToSlider, sliderToScale, wheelZoom } from "./zoom";
import { clickPick } from "./pick";

interface Props {
  minTree: MinTree;
  before: number[];
  after: number[];
  anchor?: number | null;
  /** Fired on a genuine click (not a drag) on a node in `pickable`. */
  onPick?: (id: number) => void;
  /** Only nodes in this set are clickable; omitted ⇒ nothing is pickable (Results behaviour). */
  pickable?: Set<number>;
  /** "diff" (default) labels the overlay before→after; "select" labels it for anchor picking. */
  legend?: "diff" | "select";
}

const HIT_RADIUS_PX = 26;
const CLICK_SLOP_PX = 4;

export default function TreeCanvas({
  minTree,
  before,
  after,
  anchor = null,
  onPick,
  pickable,
  legend = "diff",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const indexRef = useRef<SpatialIndex | null>(null);
  const vpRef = useRef<Viewport>({ x: 0, y: 0, zoom: 0.05 });
  const sizeRef = useRef<Size>({ width: 0, height: 0 });
  const rangeRef = useRef({ min: 1e-4, max: 1 });
  const hoverRef = useRef<number | null>(null);
  const dirtyRef = useRef(true);
  const fittedRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; moved: number } | null>(null);

  const [scale, setScale] = useState(0.05);
  const [tip, setTip] = useState<{ id: number; x: number; y: number } | null>(null);

  const diff = useMemo(
    () => ({ before: new Set(before), after: new Set(after), anchor }),
    [before, after, anchor],
  );
  const diffRef = useRef(diff);
  diffRef.current = diff;

  if (!indexRef.current) indexRef.current = buildSpatialIndex(minTree);

  useEffect(() => {
    indexRef.current = buildSpatialIndex(minTree);
    fittedRef.current = false;
    dirtyRef.current = true;
  }, [minTree]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [diff]);

  const applyScale = (next: number, anchorScreen?: { x: number; y: number }) => {
    const vp = vpRef.current;
    const size = sizeRef.current;
    const clamped = clampScale(next, rangeRef.current);
    if (anchorScreen && size.width > 0) {
      const before2 = screenToWorld(vp, size, anchorScreen.x, anchorScreen.y);
      vp.zoom = clamped;
      const after2 = screenToWorld(vp, size, anchorScreen.x, anchorScreen.y);
      vp.x += before2.wx - after2.wx;
      vp.y += before2.wy - after2.wy;
    } else {
      vp.zoom = clamped;
    }
    setScale(clamped);
    dirtyRef.current = true;
  };

  const fit = () => {
    const vp = fitToBounds(minTree.bounds, sizeRef.current, 40);
    vpRef.current = vp;
    setScale(vp.zoom);
    dirtyRef.current = true;
  };

  // Mount-only: sizing, listeners, rAF loop.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { width: rect.width, height: rect.height };
      rangeRef.current = scaleRange(minTree.bounds, sizeRef.current);
      if (!fittedRef.current && rect.width > 0) {
        vpRef.current = fitToBounds(minTree.bounds, sizeRef.current, 40);
        setScale(vpRef.current.zoom);
        fittedRef.current = true;
      }
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const steps = e.deltaY < 0 ? 1 : -1;
      applyScale(wheelZoom(vpRef.current.zoom, steps, rangeRef.current), {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const loop = () => {
      if (dirtyRef.current && indexRef.current) {
        drawTree(ctx, {
          tree: minTree,
          index: indexRef.current,
          vp: vpRef.current,
          size: sizeRef.current,
          diff: diffRef.current,
          hover: hoverRef.current,
        });
        dirtyRef.current = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minTree]);

  const pickAt = (sx: number, sy: number): number | null => {
    const vp = vpRef.current;
    if (!indexRef.current) return null;
    const w = screenToWorld(vp, sizeRef.current, sx, sy);
    return nodeAt(indexRef.current, minTree, w.wx, w.wy, HIT_RADIUS_PX / vp.zoom);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, moved: 0 };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const vp = vpRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      vp.x -= dx / vp.zoom;
      vp.y -= dy / vp.zoom;
      dirtyRef.current = true;
      if (tip) setTip(null);
      return;
    }
    const hit = pickAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit !== hoverRef.current) {
      hoverRef.current = hit;
      dirtyRef.current = true;
    }
    (e.currentTarget as HTMLElement).style.cursor =
      hit != null && pickable?.has(hit) ? "pointer" : "";
    if (hit == null) {
      if (tip) setTip(null);
    } else {
      setTip({ id: hit, x: e.clientX, y: e.clientY });
    }
  };

  const onPointerLeave = () => {
    if (hoverRef.current !== null) {
      hoverRef.current = null;
      dirtyRef.current = true;
    }
    setTip(null);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !onPick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = pickAt(e.clientX - rect.left, e.clientY - rect.top);
    const id = clickPick(drag.moved, CLICK_SLOP_PX, hit, pickable);
    if (id != null) onPick(id);
  };

  const tipNode = tip ? minTree.nodesById.get(tip.id) ?? null : null;
  const range = rangeRef.current;

  return (
    <div className="canvas-wrap">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      />

      <div className="canvas-legend">
        <div>
          <span className="sw" style={{ background: "#c8a86a" }} /> allocated
        </div>
        {legend === "diff" && (
          <div>
            <span className="sw" style={{ background: "#5aa85a" }} /> added
          </div>
        )}
        <div>
          <span className="sw" style={{ background: "#d76050" }} /> {legend === "select" ? "freed" : "dropped"}
        </div>
        {anchor != null && (
          <div>
            <span className="sw" style={{ background: "#6a9ec8" }} /> anchor
          </div>
        )}
      </div>

      <div className="canvas-controls">
        <button
          type="button"
          aria-label="zoom out"
          onClick={() => applyScale(wheelZoom(vpRef.current.zoom, -2, range))}
        >
          &minus;
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={scaleToSlider(scale, range)}
          aria-label="zoom"
          onChange={(e) => applyScale(sliderToScale(Number(e.target.value), range))}
        />
        <button
          type="button"
          aria-label="zoom in"
          onClick={() => applyScale(wheelZoom(vpRef.current.zoom, 2, range))}
        >
          +
        </button>
        <button type="button" onClick={fit}>
          fit
        </button>
      </div>

      {tip && tipNode && (
        <div className="canvas-tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <div className="name">{tipNode.name || `node ${tipNode.id}`}</div>
          {tipNode.statLines.map((s, i) => (
            <div className="stat" key={i}>
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
