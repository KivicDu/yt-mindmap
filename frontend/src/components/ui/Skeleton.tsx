import './Skeleton.css'

/**
 * A quiet placeholder shown while a list loads. Announced to screen readers
 * once per group, so a screen full of bars is not read out individually.
 */
export function SkeletonList({
  rows = 3,
  label = 'Đang tải…',
}: {
  rows?: number
  label?: string
}) {
  return (
    <div className="skeleton-list" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index} aria-hidden="true">
          <span className="skeleton-bar skeleton-bar--title" />
          <span className="skeleton-bar skeleton-bar--meta" />
        </div>
      ))}
    </div>
  )
}

/** Inline placeholder for a single block of text. */
export function SkeletonText({ width = '100%' }: { width?: string }) {
  return <span className="skeleton-bar" style={{ width }} aria-hidden="true" />
}
