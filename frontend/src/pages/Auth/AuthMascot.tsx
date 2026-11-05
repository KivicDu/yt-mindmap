import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'

export type AuthMascotMood =
  | 'idle'
  | 'typing'
  | 'privacy'
  | 'peek'
  | 'success'
  | 'error'

interface AuthMascotProps {
  mood: AuthMascotMood
  caretPosition: number
  focusTarget: { x: number; y: number } | null
}

function AuthMascot({ mood, caretPosition, focusTarget }: AuthMascotProps) {
  const mascotRef = useRef<HTMLDivElement>(null)
  const moodRef = useRef(mood)
  const focusTargetRef = useRef(focusTarget)
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    moodRef.current = mood
    focusTargetRef.current = focusTarget
  }, [mood, focusTarget])

  useEffect(() => {
    const mascot = mascotRef.current
    if (!mascot) return

    let frame = 0

    const handlePointerMove = (event: PointerEvent) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY }
      if (moodRef.current !== 'idle' || focusTargetRef.current) return

      const bounds = mascot.getBoundingClientRect()
      const x = Math.max(-1, Math.min(1, (event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2)))
      const y = Math.max(-1, Math.min(1, (event.clientY - (bounds.top + bounds.height / 2)) / (bounds.height / 2)))

      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        mascot.style.setProperty('--gaze-x', `${(x * 3.5).toFixed(2)}px`)
        mascot.style.setProperty('--gaze-y', `${(y * 2.5).toFixed(2)}px`)
        mascot.style.setProperty('--head-tilt', `${(x * 2.5).toFixed(2)}deg`)
        mascot.style.setProperty('--mouth-x', `${(x * 2.4).toFixed(2)}px`)
        mascot.style.setProperty('--mouth-y', `${(y * 1.4).toFixed(2)}px`)
        mascot.style.setProperty('--mouth-tilt', `${(x * 5).toFixed(2)}deg`)
        mascot.classList.add('auth-mascot--look')
      })
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      cancelAnimationFrame(frame)
    }
  }, [])

  useLayoutEffect(() => {
    const mascot = mascotRef.current
    if (!mascot) return

    if (!focusTarget) {
      mascot.classList.remove('auth-mascot--look')
      const pointer = pointerPositionRef.current
      if (moodRef.current === 'idle' && pointer) {
        const bounds = mascot.getBoundingClientRect()
        const x = Math.max(-1, Math.min(1, (pointer.x - (bounds.left + bounds.width / 2)) / (bounds.width / 2)))
        const y = Math.max(-1, Math.min(1, (pointer.y - (bounds.top + bounds.height / 2)) / (bounds.height / 2)))
        mascot.style.setProperty('--gaze-x', `${(x * 3.5).toFixed(2)}px`)
        mascot.style.setProperty('--gaze-y', `${(y * 2.5).toFixed(2)}px`)
        mascot.style.setProperty('--head-tilt', `${(x * 2.5).toFixed(2)}deg`)
        mascot.style.setProperty('--mouth-x', `${(x * 2.4).toFixed(2)}px`)
        mascot.style.setProperty('--mouth-y', `${(y * 1.4).toFixed(2)}px`)
        mascot.style.setProperty('--mouth-tilt', `${(x * 5).toFixed(2)}deg`)
        mascot.classList.add('auth-mascot--look')
      }
      return
    }

    const bounds = mascot.getBoundingClientRect()
    const x = Math.max(-1, Math.min(1, (focusTarget.x - (bounds.left + bounds.width / 2)) / (bounds.width / 2)))
    const y = Math.max(-1, Math.min(1, (focusTarget.y - (bounds.top + bounds.height / 2)) / (bounds.height / 2)))
    mascot.style.setProperty('--gaze-x', `${(x * 3.5).toFixed(2)}px`)
    mascot.style.setProperty('--gaze-y', `${(y * 2.5).toFixed(2)}px`)
    mascot.style.setProperty('--head-tilt', `${(x * 2.5).toFixed(2)}deg`)
    mascot.style.setProperty('--mouth-x', `${(x * 2.4).toFixed(2)}px`)
    mascot.style.setProperty('--mouth-y', `${(y * 1.4).toFixed(2)}px`)
    mascot.style.setProperty('--mouth-tilt', `${(x * 5).toFixed(2)}deg`)
    mascot.classList.remove('auth-mascot--look')
  }, [focusTarget])

  return (
    <div
      ref={mascotRef}
      className={`auth-mascot auth-mascot--${mood}`}
      style={{ '--caret-x': `${Math.max(-3.5, Math.min(3.5, caretPosition))}px` } as CSSProperties}
      aria-hidden="true"
    >
      <svg className="auth-mascot-art" viewBox="0 0 440 360">
        <path className="mascot-branch mascot-branch--one" d="M183 145 C148 135 137 105 112 86 L91 76" />
        <path className="mascot-branch mascot-branch--two" d="M184 214 C150 231 130 260 91 275" />
        <path className="mascot-branch mascot-branch--three" d="M278 145 C314 128 320 91 348 70" />
        <path className="mascot-branch mascot-branch--four" d="M280 184 C319 183 330 183 362 183" />
        <path className="mascot-branch mascot-branch--five" d="M272 222 C300 246 310 273 335 289" />

        <g className="mascot-node mascot-node--one">
          <rect x="34" y="46" width="58" height="58" rx="14" />
          <circle cx="63" cy="75" r="6" />
        </g>
        <g className="mascot-node mascot-node--two">
          <rect x="35" y="253" width="58" height="44" rx="13" />
          <circle cx="64" cy="275" r="5" />
        </g>
        <g className="mascot-node mascot-node--three">
          <rect x="344" y="43" width="54" height="54" rx="15" />
          <circle cx="371" cy="70" r="5.5" />
        </g>
        <g className="mascot-node mascot-node--four">
          <rect x="360" y="160" width="48" height="48" rx="14" />
          <circle cx="384" cy="184" r="5" />
        </g>
        <g className="mascot-node mascot-node--five">
          <rect x="328" y="275" width="58" height="40" rx="13" />
          <circle cx="357" cy="295" r="5" />
        </g>

        <g className="mascot-character">
          <path className="mascot-arm mascot-arm--left" d="M177 193 C158 196 157 215 145 218" />
          <path className="mascot-arm mascot-arm--right" d="M281 190 C299 184 303 166 315 164" />
          <path className="mascot-foot mascot-foot--left" d="M202 238 L194 253 Q193 259 201 259 H218" />
          <path className="mascot-foot mascot-foot--right" d="M257 238 L265 253 Q266 259 258 259 H241" />

          <rect className="mascot-core" x="166" y="112" width="126" height="126" rx="22" />
          <path className="mascot-core-top" d="M191 112 H267 Q292 112 292 137 V147 H166 V137 Q166 112 191 112Z" />

          <g className="mascot-face">
            <g className="mascot-eyes">
              <ellipse className="mascot-eye-socket" cx="207" cy="174" rx="12" ry="15" />
              <ellipse className="mascot-eye-socket" cx="251" cy="174" rx="12" ry="15" />
              <circle className="mascot-pupil" cx="210" cy="175" r="5" />
              <circle className="mascot-pupil" cx="254" cy="175" r="5" />
              <circle className="mascot-eye-glint" cx="212" cy="172" r="1.5" />
              <circle className="mascot-eye-glint" cx="256" cy="172" r="1.5" />
            </g>
            <path className="mascot-closed-eyes" d="M196 176 Q207 186 218 176 M240 176 Q251 186 262 176" />
            <g className="mascot-away-eyes">
              <ellipse className="mascot-eye-socket" cx="207" cy="174" rx="12" ry="15" />
              <ellipse className="mascot-eye-socket" cx="251" cy="174" rx="12" ry="15" />
              <circle className="mascot-pupil mascot-pupil--away" cx="207" cy="175" r="5" />
              <circle className="mascot-pupil mascot-pupil--away" cx="251" cy="175" r="5" />
              <circle className="mascot-eye-glint" cx="205" cy="172" r="1.5" />
              <circle className="mascot-eye-glint" cx="249" cy="172" r="1.5" />
            </g>
            <path className="mascot-mouth mascot-mouth--smile" d="M211 204 Q229 222 247 204" />
            <path className="mascot-mouth mascot-mouth--smirk" d="M211 212 Q228 219 247 202" />
            <path className="mascot-mouth mascot-mouth--grin" d="M211 204 Q229 225 247 204 Q245 235 229 235 Q213 235 211 204Z" />
            <path className="mascot-mouth-tongue" d="M220 229 Q229 223 238 229 Q235 237 229 237 Q223 237 220 229Z" />
            <path className="mascot-mouth mascot-mouth--frown" d="M211 214 Q229 196 247 214" />
            <circle className="mascot-blush mascot-blush--left" cx="188" cy="199" r="7" />
            <circle className="mascot-blush mascot-blush--right" cx="270" cy="199" r="7" />
          </g>

        </g>

        <path className="mascot-celebration" d="M150 98 L155 109 L166 114 L155 119 L150 130 L145 119 L134 114 L145 109 Z" />
        <path className="mascot-celebration mascot-celebration--two" d="M305 242 L309 251 L318 255 L309 259 L305 268 L301 259 L292 255 L301 251 Z" />
        <path className="mascot-confused" d="M302 102 Q314 91 324 102" />
      </svg>
    </div>
  )
}

export default AuthMascot
