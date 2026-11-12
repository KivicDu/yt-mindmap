import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import MapStyleDialog from './MapStyleDialog'
import { readStoredStyle, storeStyle, type MapStyle } from '../lib/mapStyle'

interface NewProjectButtonProps {
  className?: string
  children: ReactNode
}

/**
 * "New project" now opens the look picker first, then hands the choice to the
 * workspace through the URL. Keeping this in one component means every entry
 * point (dashboard header, empty list) behaves the same.
 */
export default function NewProjectButton({ className, children }: NewProjectButtonProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [initial, setInitial] = useState<MapStyle>(() => readStoredStyle())

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <MapStyleDialog
        open={open}
        initial={initial}
        title="Tạo dự án mới"
        confirmLabel="Bắt đầu"
        onClose={() => setOpen(false)}
        onConfirm={(style) => {
          storeStyle(style)
          setInitial(style)
          setOpen(false)
          navigate(`/app?layout=${style.layout}&palette=${style.palette}`)
        }}
      />
    </>
  )
}
