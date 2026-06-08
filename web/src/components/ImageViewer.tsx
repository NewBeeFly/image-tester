import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

export type ImageViewerHandle = {
  resetView: () => void
}

type Status = 'idle' | 'loading' | 'error'

type Props = {
  src: string
  alt: string
  hasPrev?: boolean
  hasNext?: boolean
  onPrev?: () => void
  onNext?: () => void
}

const MIN_SCALE = 0.25
const MAX_SCALE = 8
const STEP = 1.25
const WHEEL_SENSITIVITY = 0.0015

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

export const ImageViewer = forwardRef<ImageViewerHandle, Props>(function ImageViewer(
  { src, alt, hasPrev, hasNext, onPrev, onNext },
  ref,
) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [status, setStatus] = useState<Status>('loading')
  const naturalRef = useRef<{ w: number; h: number } | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  // 关闭所有内部交互时暴露给父级：缩放重置、平移归零
  useImperativeHandle(ref, () => ({
    resetView: () => {
      setScale(1)
      setTx(0)
      setTy(0)
    },
  }))

  // src 变化时进入 loading
  useEffect(() => {
    setStatus('loading')
  }, [src, retryToken])

  const handleLoad = useCallback(() => {
    const img = imgRef.current
    if (img) naturalRef.current = { w: img.naturalWidth, h: img.naturalHeight }
    setStatus('idle')
    // 自然加载时把 view 重置为 fit
    setScale(1)
    setTx(0)
    setTy(0)
  }, [])

  const handleError = useCallback(() => {
    setStatus('error')
  }, [])

  // 工具条：放大
  const zoomIn = useCallback(() => {
    setScale((s) => clamp(s * STEP, MIN_SCALE, MAX_SCALE))
  }, [])

  // 工具条：缩小
  const zoomOut = useCallback(() => {
    setScale((s) => clamp(s / STEP, MIN_SCALE, MAX_SCALE))
  }, [])

  // 工具条：点击倍率 — 100% ↔ fit 切换（未加载时只到 100%）
  const toggleFit100 = useCallback(() => {
    setScale((prev) => {
      const stage = stageRef.current
      const natural = naturalRef.current
      if (!stage || !natural) return 1  // 兜底：未加载则回到 1
      const fitScale = Math.min(stage.clientWidth / natural.w, stage.clientHeight / natural.h)
      if (fitScale <= 0) return 1
      // 如果当前是 1 (或非常接近 fitScale)，切到另一个
      if (Math.abs(prev - 1) < 0.001) {
        setTx(0)
        setTy(0)
        return fitScale
      }
      if (Math.abs(prev - fitScale) < 0.001) {
        setTx(0)
        setTy(0)
        return 1
      }
      // 其他缩放状态：回到 1
      setTx(0)
      setTy(0)
      return 1
    })
  }, [])

  // 工具条：适应
  const fit = useCallback(() => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [])

  // 滚轮缩放：仅在 stage 上拦截，preventDefault 防止外层列表滚动
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      const stage = stageRef.current
      if (!stage) return
      e.preventDefault()
      const rect = stage.getBoundingClientRect()
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      // 屏幕坐标 → wrap 中心坐标 → wrap 局部像素（除以当前 scale）
      const cursorOffsetX = e.clientX - rect.left - centerX - tx
      const cursorOffsetY = e.clientY - rect.top - centerY - ty
      const pixX = cursorOffsetX / scale
      const pixY = cursorOffsetY / scale
      const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY)
      const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE)
      if (newScale === scale) return
      setScale(newScale)
      // 保持光标下像素不动：newTx = cursorOffset - newScale · pixX
      setTx(e.clientX - rect.left - centerX - newScale * pixX)
      setTy(e.clientY - rect.top - centerY - newScale * pixY)
    },
    [tx, ty, scale],
  )

  // 拖动：仅记录拖动起点，松手前持续更新 tx/ty
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseTx: number; baseTy: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseTx: 0,
    baseTy: 0,
  })

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseTx: tx,
      baseTy: ty,
    }
  }, [tx, ty])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    setTx(dragRef.current.baseTx + (e.clientX - dragRef.current.startX))
    setTy(dragRef.current.baseTy + (e.clientY - dragRef.current.startY))
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current.active = false
  }, [])

  return (
    <div
      className="ivStage"
      ref={stageRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="ivImgWrap"
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
      >
        <img
          ref={imgRef}
          className="ivImg"
          src={status === 'error' ? '' : `${src}${retryToken ? `?retry=${retryToken}` : ''}`}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          draggable={false}
        />
      </div>

      {hasPrev ? (
        <button
          type="button"
          className="ivNav ivNavPrev"
          onClick={onPrev}
          aria-label="上一张"
        >
          ‹
        </button>
      ) : null}
      {hasNext ? (
        <button
          type="button"
          className="ivNav ivNavNext"
          onClick={onNext}
          aria-label="下一张"
        >
          ›
        </button>
      ) : null}

      <div className="ivToolbar">
        <button type="button" onClick={zoomOut} aria-label="缩小">−</button>
        <button type="button" onClick={toggleFit100}>
          {Math.round(scale * 100)}%
        </button>
        <button type="button" onClick={zoomIn} aria-label="放大">+</button>
        <button type="button" onClick={fit}>适应</button>
      </div>

      {status === 'loading' ? <div className="ivSpinner">加载中…</div> : null}
      {status === 'error' ? (
        <div className="ivError">
          <span>加载失败</span>
          <button type="button" onClick={() => setRetryToken((n) => n + 1)}>
            重试
          </button>
        </div>
      ) : null}
    </div>
  )
})
