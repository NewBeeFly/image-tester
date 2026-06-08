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
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  // 占位：natural 供 Task 2/3 计算 fit 缩放使用
  void natural
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
    if (img) setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    setStatus('idle')
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

  // 工具条：点击倍率 — 100% ↔ 适应
  // TODO 占位：当前恒为 1，fit vs 100% 切换需要 stage 尺寸（Task 3 之后才能实现）
  const toggleFit100 = useCallback(() => {
    setScale((s) => (s === 1 ? 1 : 1))
  }, [])

  // 工具条：适应
  const fit = useCallback(() => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [])

  return (
    <div className="ivStage" ref={stageRef}>
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
