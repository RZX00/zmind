import gsap from 'gsap'
import { clampScale as clampViewScale } from '../../../services/canvas-view-state.service'
import type { CanvasNode } from '../../../../types/canvas'
import type { PathNode } from './PathAnalyzer'

interface CameraState {
  x: number
  y: number
  scale: number
  viewportWidth: number
  viewportHeight: number
}

interface CameraKeyframe {
  timestamp: number
  state: CameraState
  node: CanvasNode
  focusPercentage: number
  duration: number
  transitionDuration: number
}

interface AnimationSequence {
  id: string
  name: string
  keyframes: CameraKeyframe[]
  totalDuration: number
}

type FocusListener = (nodeId: string | null) => void
type ProgressListener = (progress: number) => void

class CameraAnimatorImpl {
  private transformRef: any = null
  private current: CameraState = {
    x: 0,
    y: 0,
    scale: 1,
    viewportWidth: (typeof window !== 'undefined') ? window.innerWidth : 1200,
    viewportHeight: (typeof window !== 'undefined') ? window.innerHeight : 800,
  }
  public animationTimeline: gsap.core.Timeline | null = null
  private currentSeq: AnimationSequence | null = null
  private paused = false
  private focusNodeId: string | null = null
  private speed = 1.0
  private loop = false
  private transitionSpeed: 'slow' | 'medium' | 'fast' | 'adaptive' = 'adaptive'
  private motionProfile: 'natural' | 'constant' | 'cinematic' = 'natural'
  private focusListeners = new Set<FocusListener>()
  private progressListeners = new Set<ProgressListener>()
  private lastProgressEmit = 0
  private lastProgressValue = 0
  private lastDomTransform: string | null = null
  private useDomTransform = true
  private readyWaiters = new Set<() => void>()
  private currentPlayResolve: (() => void) | null = null
  private currentPlayId = 0
  private resizeObserver: ResizeObserver | null = null
  private resizeObservedEl: HTMLElement | null = null
  private resizeListener: (() => void) | null = null

  setTransformRef(ref: any) {
    this.transformRef = ref
    const r = (ref && 'current' in ref) ? ref.current : ref
    if (r?.instance?.wrapperComponent) {
      const rect = r.instance.wrapperComponent.getBoundingClientRect()
      this.current.viewportWidth = rect.width
      this.current.viewportHeight = rect.height
    }
    if (this.readyWaiters.size) {
      this.readyWaiters.forEach((fn) => {
        try { fn() } catch { /* ignore listener errors */ }
      })
      this.readyWaiters.clear()
    }
  }

  private applyDomTransform(positionX: number, positionY: number, scale: number): boolean {
    if (!this.useDomTransform) return false
    const r = (this.transformRef && 'current' in this.transformRef) ? this.transformRef.current : this.transformRef
    const instance = r?.instance
    const content: HTMLElement | undefined = instance?.contentComponent
    if (!content) return false
    const clampedScale = clampViewScale(scale, 0.1, 3)
    const transform = `translate3d(${positionX}px, ${positionY}px, 0) scale(${clampedScale})`
    if (this.lastDomTransform !== transform) {
      content.style.transform = transform
      content.style.transformOrigin = '0 0'
      content.style.willChange = 'transform'
      this.lastDomTransform = transform
    }
    // keep transform state in sync without triggering React renders
    if (instance?.transformState) {
      instance.transformState.positionX = positionX
      instance.transformState.positionY = positionY
      instance.transformState.scale = clampedScale
    }
    if (r?.state) {
      r.state.positionX = positionX
      r.state.positionY = positionY
      r.state.scale = clampedScale
    }
    return true
  }

  private setTransform(x: number, y: number, scale: number) {
    if (!this.transformRef) return
    const r = (this.transformRef && 'current' in this.transformRef) ? this.transformRef.current : this.transformRef
    if (!r) return
    // react-zoom-pan-pinch: setTransform(positionX, positionY, scale)
    const clampedScale = clampViewScale(scale, 0.1, 3)
    if (this.applyDomTransform(x, y, clampedScale)) return
    r.setTransform(x, y, clampedScale)
  }

  private async waitForTransformRef(timeoutMs: number = 2000): Promise<boolean> {
    if (this.transformRef) return true
    return await new Promise((resolve) => {
      let done = false
      const onReady = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        this.readyWaiters.delete(onReady)
        resolve(true)
      }
      const timer = setTimeout(() => {
        if (done) return
        done = true
        this.readyWaiters.delete(onReady)
        resolve(false)
      }, timeoutMs)
      this.readyWaiters.add(onReady)
    })
  }

  private snapTransformToPixelGrid() {
    const r = (this.transformRef && 'current' in this.transformRef) ? this.transformRef.current : this.transformRef
    const instance = r?.instance
    const content: HTMLElement | undefined = instance?.contentComponent
    const st = r?.state || instance?.transformState
    if (!content || !st) return
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
    const px = Math.round((st.positionX || 0) * dpr) / dpr
    const py = Math.round((st.positionY || 0) * dpr) / dpr
    const scale = clampViewScale(st.scale || 1, 0.1, 3)
    const transform = `translate(${px}px, ${py}px) scale(${scale})`
    if (this.lastDomTransform !== transform) {
      content.style.transform = transform
      content.style.transformOrigin = '0 0'
      this.lastDomTransform = transform
    }
    content.style.willChange = ''
    if (instance?.transformState) {
      instance.transformState.positionX = px
      instance.transformState.positionY = py
      instance.transformState.scale = scale
    }
    if (r?.state) {
      r.state.positionX = px
      r.state.positionY = py
      r.state.scale = scale
    }
  }

  /**
   * Smoothly animate camera to focus a world-space bounding box.
   * bbox: world coords { x, y, w, h }, focusPct: 0..1 of viewport usage
   */
  async flyToBBox(bbox: { x: number; y: number; w: number; h: number }, focusPct: number = 0.65) {
    if (!this.transformRef) return
    const vw = this.current.viewportWidth
    const vh = this.current.viewportHeight
    const targetW = Math.max(1, bbox.w)
    const targetH = Math.max(1, bbox.h)
    const sx = vw * focusPct / targetW
    const sy = vh * focusPct / targetH
    const scale = clampViewScale(Math.min(sx, sy), 0.1, 3)
    const cx = bbox.x + targetW / 2
    const cy = bbox.y + targetH / 2
    const { positionX, positionY } = this.worldToScreenOffset(cx, cy, scale)

    // Duration based on distance + profile speed
    const dx = positionX - (this.transformRef.current?.state?.positionX || 0)
    const dy = positionY - (this.transformRef.current?.state?.positionY || 0)
    const dd = Math.hypot(dx, dy)
    let base = 650
    switch (this.transitionSpeed) {
      case 'slow': base = 1000; break
      case 'medium': base = 750; break
      case 'fast': base = 500; break
      case 'adaptive': default: base = Math.max(450, Math.min(1200, dd / 0.9)); break
    }

    // Use gsap for smoothness if available
    try {
      if (this.animationTimeline) this.animationTimeline.kill()
      this.animationTimeline = gsap.timeline({ defaults: { ease: 'power2.out' } })
      const ref = this.transformRef
      const st = ref?.current?.state || {}
      const from = { positionX: st.positionX || 0, positionY: st.positionY || 0, scale: st.scale || 1 }
      const to = { positionX, positionY, scale }
      // Interpolate; use onUpdate to apply transform
      const proxy = { ...from }
      this.animationTimeline.to(proxy, {
        positionX: to.positionX,
        positionY: to.positionY,
        scale: to.scale,
        duration: base / 1000,
        onUpdate: () => { this.setTransform(proxy.positionX, proxy.positionY, proxy.scale) },
      })
      await this.animationTimeline.then?.(() => {})
    } catch {
      // Fallback to immediate setTransform
      this.setTransform(positionX, positionY, scale)
    }
  }

  private centerOnNodeState(node: CanvasNode, focusPct: number): CameraState {
    const vw = this.current.viewportWidth
    const vh = this.current.viewportHeight
    const margin = 0.1 // 10% 边距
    const targetW = node.width / (1 - margin)
    const targetH = node.height / (1 - margin)
    const scaleX = vw * (focusPct) / targetW
    const scaleY = vh * (focusPct) / targetH
    const scale = clampViewScale(Math.min(scaleX, scaleY), 0.1, 3)
    // 返回世界坐标中心（非屏幕偏移）
    const cx = node.x + node.width / 2
    const cy = node.y + node.height / 2
    return {
      x: cx,
      y: cy,
      scale,
      viewportWidth: vw,
      viewportHeight: vh,
    }
  }

  private worldToScreenOffset(worldX: number, worldY: number, scale: number) {
    const vw = this.current.viewportWidth
    const vh = this.current.viewportHeight
    const positionX = vw / 2 - worldX * scale
    const positionY = vh / 2 - worldY * scale
    return { positionX, positionY }
  }

  private emitFocus(nodeId: string | null) {
    this.focusNodeId = nodeId
    this.focusListeners.forEach((fn) => {
      try { fn(nodeId) } catch { /* ignore listener errors */ }
    })
  }

  private emitProgress(progress: number) {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    const deltaT = now - this.lastProgressEmit
    const deltaP = Math.abs(progress - this.lastProgressValue)
    // Throttle: at most ~8fps or when meaningful change
    if (deltaT < 120 && deltaP < 0.02) return
    this.lastProgressEmit = now
    this.lastProgressValue = progress
    this.progressListeners.forEach((fn) => {
      try { fn(progress) } catch { /* ignore listener errors */ }
    })
  }

  private calculateTransitionDuration(prev: CameraKeyframe | null, cur: CameraKeyframe): number {
    if (!prev) return 800
    const dx = cur.state.x - prev.state.x
    const dy = cur.state.y - prev.state.y
    const distance = Math.hypot(dx, dy)
    let base: number
    switch (this.transitionSpeed) {
      case 'slow': base = 2400; break
      case 'medium': base = 1600; break
      case 'fast': base = 1000; break
      case 'adaptive':
      default:
        // 更平滑的自适应：以近似匀速为主（distance / vel），再夹取范围
        // 设定虚拟速度：每 ms 前进 0.6px（可调）
        const vel = 0.6
        base = distance / vel
        break
    }
    return Math.max(550, Math.min(2500, base))
  }

  async createAnimationSequence(pathNodes: PathNode[], name: string): Promise<AnimationSequence> {
    const ready = await this.waitForTransformRef()
    if (!ready) return { id: `seq_${Date.now()}`, name, keyframes: [], totalDuration: 0 }
    const keyframes: CameraKeyframe[] = []
    for (const pn of pathNodes) {
      const state = this.centerOnNodeState(pn.node, pn.focusPercentage)
      keyframes.push({ timestamp: 0, state, node: pn.node, focusPercentage: pn.focusPercentage, duration: pn.duration, transitionDuration: 0 })
    }
    // 首次计算过渡时长（自适应）
    for (let i = 0; i < keyframes.length; i++) {
      const prev = i > 0 ? keyframes[i - 1] : null
      const cur = keyframes[i]
      const trans = this.calculateTransitionDuration(prev, cur)
      cur.transitionDuration = trans
    }
    // 平滑过渡时长，避免相邻段差异过大导致速度感剧变（指数平滑）
    if (keyframes.length > 1) {
      let prevDur = keyframes[0].transitionDuration
      for (let i = 1; i < keyframes.length; i++) {
        const curDur = keyframes[i].transitionDuration
        const alpha = 0.65 // 趋向当前，保留一定连续性
        const smoothed = prevDur + (curDur - prevDur) * alpha
        // 轻微夹取，进一步抑制突变
        keyframes[i].transitionDuration = Math.max(550, Math.min(2500, smoothed))
        prevDur = keyframes[i].transitionDuration
      }
    }
    // 重新计算时间戳
    let t = 0
    for (let i = 0; i < keyframes.length; i++) {
      const kf = keyframes[i]
      kf.timestamp = t
      t += kf.transitionDuration + kf.duration
    }
    return { id: `seq_${Date.now()}`, name, keyframes, totalDuration: t }
  }

  private applyFrame(kf: CameraKeyframe) {
    this.setTransform(kf.state.x, kf.state.y, kf.state.scale)
  }

  async playSequence(seq: AnimationSequence) {
    const ready = await this.waitForTransformRef()
    if (!ready || !this.transformRef) return
    this.stopAnimation()
    const playId = ++this.currentPlayId
    let resolved = false
    let resolveOnce: (() => void) | null = null
    const completion = new Promise<void>((resolve) => {
      resolveOnce = () => {
        if (resolved) return
        resolved = true
        if (this.currentPlayId === playId) this.currentPlayResolve = null
        resolve()
      }
    })
    this.currentPlayResolve = resolveOnce
    this.currentSeq = seq
    this.emitProgress(0)
    const tl = gsap.timeline({ paused: true })
    // 初始化为当前视图的世界中心和缩放
    let last = { x: this.current.x, y: this.current.y, scale: this.current.scale }
    const r = (this.transformRef && 'current' in this.transformRef) ? this.transformRef.current : this.transformRef
    const tstate = r?.state
    if (tstate) {
      const vw = this.current.viewportWidth
      const vh = this.current.viewportHeight
      const scale = clampViewScale(tstate.scale, 0.1, 3)
      const worldX = (vw / 2 - tstate.positionX) / scale
      const worldY = (vh / 2 - tstate.positionY) / scale
      last = { x: worldX, y: worldY, scale }
    }
    for (const kf of seq.keyframes) {
      const to = { x: kf.state.x, y: kf.state.y, scale: kf.state.scale }
      const proxy = { ...last }
      tl.to(proxy, {
        x: to.x,
        y: to.y,
        scale: to.scale,
        duration: Math.max(0.1, kf.transitionDuration / 1000),
        ease: this.motionProfile === 'constant' ? 'none' : (this.motionProfile === 'cinematic' ? 'power3.inOut' : 'power1.inOut'),
        onUpdate: () => {
          // 更柔和的缩放：极细量化，位置不取整，减少台阶感
          const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
          const baseScale = clampViewScale(proxy.scale, 0.1, 3)
          const quantStep = Math.max(1 / (dpr * 16), 0.0001)
          const scaleQ = Math.max(0.1, Math.min(3, Math.round(baseScale / quantStep) * quantStep))
          const off = this.worldToScreenOffset(proxy.x, proxy.y, scaleQ)
          this.setTransform(off.positionX, off.positionY, scaleQ)
        },
      })
      // 标记当前聚焦节点（在停留阶段开始）
      tl.call(() => { this.emitFocus(kf.node.id) })
      // dwell
      tl.to({}, { duration: kf.duration / 1000 })
      last = to
    }
    this.animationTimeline = tl
    this.paused = false
    tl.eventCallback('onUpdate', () => {
      this.emitProgress(tl.progress())
    })
    tl.timeScale(this.speed)
    tl.play(0)
    tl.eventCallback('onComplete', () => {
      if (this.currentPlayId !== playId) return
      this.emitProgress(1)
      if (this.loop && this.currentSeq) {
        this.emitProgress(0)
        tl.play(0)
        return
      }
      this.snapTransformToPixelGrid()
      resolveOnce?.()
    })
    await completion
  }

  pauseAnimation() {
    if (this.animationTimeline) {
      this.animationTimeline.pause()
      this.paused = true
    }
  }
  resumeAnimation() {
    if (this.animationTimeline) {
      this.animationTimeline.play()
      this.paused = false
    }
  }
  stopAnimation() {
    if (this.animationTimeline) {
      this.animationTimeline.kill()
      this.animationTimeline = null
    }
    const resolve = this.currentPlayResolve
    if (resolve) {
      this.currentPlayResolve = null
      resolve()
    }
    this.emitProgress(0)
    this.currentSeq = null
    this.paused = false
    this.emitFocus(null)
    this.snapTransformToPixelGrid()
  }

  isPaused() { return this.paused }
  hasActiveSequence() { return !!this.currentSeq && !!this.animationTimeline }
  getAnimationInfo() {
    const dur = this.animationTimeline?.duration() || 0
    const time = this.animationTimeline?.time() || 0
    const progress = dur > 0 ? time / dur : 0
    return { totalDuration: dur * 1000, currentTime: time * 1000, progress }
  }

  getCurrentFocusNodeId() { return this.focusNodeId }

  // 速度/循环设置
  setSpeed(v: number) {
    this.speed = Math.max(0.1, Math.min(3, v))
    if (this.animationTimeline) this.animationTimeline.timeScale(this.speed)
  }
  getSpeed() { return this.speed }
  setLoop(enabled: boolean) { this.loop = !!enabled }
  getLoop() { return this.loop }
  setTransitionSpeed(speed: 'slow' | 'medium' | 'fast' | 'adaptive') { this.transitionSpeed = speed }
  getTransitionSpeed() { return this.transitionSpeed }

  // 运动曲线配置
  setMotionProfile(profile: 'natural' | 'constant' | 'cinematic') { this.motionProfile = profile }
  getMotionProfile() { return this.motionProfile }

  addFocusListener(fn: FocusListener) { this.focusListeners.add(fn) }
  removeFocusListener(fn: FocusListener) { this.focusListeners.delete(fn) }
  addProgressListener(fn: ProgressListener) { this.progressListeners.add(fn) }
  removeProgressListener(fn: ProgressListener) { this.progressListeners.delete(fn) }
}

export const cameraAnimator = new CameraAnimatorImpl()

export function getCurrentFocusNodeId() {
  return cameraAnimator.getCurrentFocusNodeId()
}
export function onFocusChange(fn: FocusListener) { cameraAnimator.addFocusListener(fn) }
export function offFocusChange(fn: FocusListener) { cameraAnimator.removeFocusListener(fn) }
export function onProgress(fn: ProgressListener) { cameraAnimator.addProgressListener(fn) }
export function offProgress(fn: ProgressListener) { cameraAnimator.removeProgressListener(fn) }

// 便捷导出（兼容旧接口习惯）
export function setPlaybackSpeed(v: number) { cameraAnimator.setSpeed(v) }
export function getPlaybackSpeed() { return cameraAnimator.getSpeed() }
export function setLoopEnabled(v: boolean) { cameraAnimator.setLoop(v) }
export function getLoopEnabled() { return cameraAnimator.getLoop() }
export function setTransitionSpeed(v: 'slow' | 'medium' | 'fast' | 'adaptive') { cameraAnimator.setTransitionSpeed(v) }
export function getTransitionSpeed() { return cameraAnimator.getTransitionSpeed() }
export function setMotionProfile(v: 'natural' | 'constant' | 'cinematic') { cameraAnimator.setMotionProfile(v) }
export function getMotionProfile() { return cameraAnimator.getMotionProfile() }
