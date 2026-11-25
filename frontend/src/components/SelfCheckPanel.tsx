import { useCallback, useEffect, useState } from 'react'
import { cleanLabel, formatTime, type MapNode } from '../lib/mindmapTree'
import { formatWhen } from '../lib/projects'
import {
  getQuiz,
  likelyMissed,
  overrideMark,
  setReview,
  submitAttempt,
  weakRangesFromMisses,
  type AttemptItem,
  type AttemptResult,
  type QuizPayload,
} from '../lib/review'
import './SelfCheckPanel.css'

type Phase = 'answering' | 'result'

interface SelfCheckPanelProps {
  projectId: string
  nodes: MapNode[]
  cues: Array<{ start: number; duration: number; text: string }>
  onSeek?: (seconds: number) => void
  onFocusTarget?: (nodeId: string) => void
  onMaskedIdsChange: (ids: string[]) => void
  onClose: () => void
}

/** ADR 0014: recall the map's own structure. Fractions, never a score. */
export default function SelfCheckPanel({
  projectId,
  nodes,
  cues,
  onSeek,
  onFocusTarget,
  onMaskedIdsChange,
  onClose,
}: SelfCheckPanelProps) {
  const [phase, setPhase] = useState<Phase>('answering')
  const [busy, setBusy] = useState(true)
  const [sending, setSending] = useState(false)
  const [quiz, setQuiz] = useState<QuizPayload | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [recallAnswers, setRecallAnswers] = useState<Record<string, string>>({})
  const [ideaAnswers, setIdeaAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [overridingId, setOverridingId] = useState<string | null>(null)
  const [reviewEnabled, setReviewEnabled] = useState(false)
  const [nextReviewAt, setNextReviewAt] = useState<string | null>(null)

  const start = useCallback(
    async (nextAttempt: number) => {
      setBusy(true)
      setError('')
      setNote('')
      setResult(null)
      try {
        const data = await getQuiz(projectId, nextAttempt)
        setAttempt(nextAttempt)
        if (data.targets.length === 0) {
          setQuiz(null)
          setNote(data.note || 'Bài này quá ngắn để tự kiểm.')
          onMaskedIdsChange([])
          return
        }
        setQuiz(data)
        setRecallAnswers({})
        setIdeaAnswers({})
        setPhase('answering')
        // The map stays readable: only the sampled labels disappear.
        onMaskedIdsChange(data.targets.map((target) => target.id))
        if (data.targets[0]) onFocusTarget?.(data.targets[0].id)
      } catch {
        setError('Không tạo được câu hỏi tự kiểm. Kiểm tra kết nối rồi thử lại.')
      } finally {
        setBusy(false)
      }
    },
    [projectId, onFocusTarget, onMaskedIdsChange],
  )

  useEffect(() => {
    // Opening this panel is itself the request to prepare a quiz; there is no
    // render-time value to derive it from (the API owns the answer key).
    // eslint-disable-next-line react/set-state-in-effect
    void start(0)
  }, [start])

  // Closing the panel (or navigating away) must always reveal the map.
  useEffect(() => () => onMaskedIdsChange([]), [onMaskedIdsChange])

  const submit = async () => {
    if (!quiz) return
    setSending(true)
    setError('')
    const recall = quiz.targets
      .filter((target) => recallAnswers[target.id]?.trim())
      .map((target) => ({ node_id: target.id, answer: recallAnswers[target.id].trim() }))
    const ideas = quiz.questions
      .filter((question) => ideaAnswers[question.id]?.trim())
      .map((question) => ({ id: question.id, answer: ideaAnswers[question.id].trim() }))
    if (recall.length === 0 && ideas.length === 0) {
      setSending(false)
      setError('Viết ít nhất một câu trả lời trước khi nộp.')
      return
    }

    // Weak ranges are navigation hints, not marks: the learner misses a minute
    // bucket when their own words share none with the branch key. The server
    // clamps the ranges before storing them.
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const misses = quiz.targets.filter((target) => {
      const node = byId.get(target.id)
      const key = [node?.label, node?.note].filter(Boolean).map(cleanLabel).join(' ')
      return likelyMissed(recallAnswers[target.id] || '', key)
    })

    try {
      const data = await submitAttempt(projectId, {
        quiz_id: quiz.quiz_id,
        attempt,
        recall,
        ideas,
        weak_ranges: weakRangesFromMisses(misses, cues),
      })
      setSending(false)
      setResult(data)
      setPhase('result')
      onMaskedIdsChange([])
      if (data.next_review_at) {
        setReviewEnabled(true)
        setNextReviewAt(data.next_review_at)
      }
    } catch {
      setSending(false)
      setError('Không gửi được bài tự kiểm. Câu trả lời vẫn còn ở đây, thử lại nhé.')
    }
  }

  const toggleMark = async (kind: 'recall' | 'ideas', item: AttemptItem) => {
    if (!result) return
    const nextCorrect = item.overridden ? item.original : !item.correct
    setOverridingId(item.id)
    setError('')
    try {
      const updated = await overrideMark(result[kind].id, item.id, nextCorrect)
      setResult({ ...result, [kind]: updated })
    } catch {
      setError('Không cập nhật được đánh giá. Thử lại.')
    } finally {
      setOverridingId(null)
    }
  }

  const toggleReminder = async (enabled: boolean) => {
    const previous = reviewEnabled
    setReviewEnabled(enabled)
    try {
      const state = await setReview(projectId, enabled)
      setReviewEnabled(state.enabled)
      setNextReviewAt(state.next_review_at)
    } catch {
      setReviewEnabled(previous)
      setError('Không cập nhật được lịch nhắc ôn lại.')
    }
  }

  const renderItems = (kind: 'recall' | 'ideas', fraction: AttemptResult['recall']) => {
    if (fraction.asked === 0) return null
    return (
      <div className="self-check__items">
        <h4>{kind === 'recall' ? 'Nhánh đã dựng lại' : 'Ý chính'}</h4>
        <ol>
          {fraction.items.map((item) => (
            <li key={`${kind}-${item.id}`} className="self-check__item">
              <div className="self-check__item-head">
                <span className={`self-check__verdict${item.correct ? ' is-right' : ''}`}>
                  {item.correct ? 'Đúng' : 'Chưa đúng'}
                </span>
                <span className="self-check__prompt">{item.prompt}</span>
              </div>
              <p className="self-check__answer">Bạn viết: {item.answer || '—'}</p>
              {!item.correct && <p className="self-check__key">Đáp án: {item.key}</p>}
              <button
                type="button"
                className="self-check__override"
                aria-pressed={item.overridden}
                disabled={overridingId === item.id}
                onClick={() => void toggleMark(kind, item)}
              >
                {overridingId === item.id
                  ? 'Đang cập nhật…'
                  : item.overridden
                    ? 'Bỏ đánh dấu tôi đúng'
                    : 'AI chấm sai, tôi đúng'}
              </button>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div className="self-check" role="region" aria-label="Tự kiểm lại bài này">
      <header className="self-check__head">
        <div>
          <span className="self-check__label">Tự kiểm</span>
          <strong>Kiểm tra lại bài này</strong>
        </div>
        <button
          type="button"
          className="btn btn--icon btn--sm"
          aria-label="Đóng tự kiểm"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <p className="self-check__intro">
        Sơ đồ là của bạn, nên chỉ bạn quyết mình hiểu tới đâu. Nhãn vài nhánh sẽ bị che; chỉ
        hiện đáp án sau khi bạn nộp. Không có điểm tổng, chỉ đếm được bạn nhớ bao nhiêu nhánh.
      </p>

      {busy && <p className="self-check__busy">Đang chuẩn bị câu hỏi từ sơ đồ…</p>}
      {error && <p className="self-check__error" role="alert">{error}</p>}
      {note && <p className="self-check__note" role="status">{note}</p>}

      {phase === 'answering' && quiz && !busy && (
        <>
          <ol className="self-check__questions">
            {quiz.targets.map((target, index) => (
              <li key={target.id}>
                <label htmlFor={`recall-${target.id}`}>
                  <span>
                    {index + 1}. {target.time != null ? `${formatTime(target.time)} · ` : ''}
                    {target.parent || 'Nhánh'}
                  </span>
                  <textarea
                    id={`recall-${target.id}`}
                    rows={2}
                    value={recallAnswers[target.id] || ''}
                    placeholder="Nhánh này nói về ý gì?"
                    onChange={(event) =>
                      setRecallAnswers((current) => ({ ...current, [target.id]: event.target.value }))
                    }
                  />
                </label>
              </li>
            ))}
          </ol>

          {quiz.ideas_available &&
            quiz.questions.map((question, index) => (
              <label className="self-check__idea" key={question.id} htmlFor={`idea-${question.id}`}>
                <span>
                  Ý chính {index + 1}. {question.prompt}
                </span>
                <textarea
                  id={`idea-${question.id}`}
                  rows={2}
                  value={ideaAnswers[question.id] || ''}
                  placeholder="Viết lại ý chính theo cách của bạn"
                  onChange={(event) =>
                    setIdeaAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                />
              </label>
            ))}

          {!quiz.ideas_available && quiz.note && (
            <p className="self-check__note">{quiz.note}</p>
          )}

          <div className="self-check__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={sending}
              onClick={() => void submit()}
            >
              {sending ? 'Đang nộp…' : 'Nộp bài tự kiểm'}
            </button>
            <button type="button" className="btn btn--outline btn--sm" onClick={onClose}>
              Bỏ qua
            </button>
          </div>
        </>
      )}

      {phase === 'result' && result && (
        <>
          <p className="self-check__message" role="status">{result.message}</p>
          <div className="self-check__fractions">
            <div>
              <span>Dựng lại nhánh</span>
              <strong>
                {result.recall.correct}/{result.recall.asked} nhánh
              </strong>
            </div>
            {result.ideas.asked > 0 && (
              <div>
                <span>Ý chính</span>
                <strong>
                  {result.ideas.correct}/{result.ideas.asked} ý chính
                </strong>
              </div>
            )}
          </div>

          {result.weak_ranges.length > 0 && (
            <div className="self-check__weak">
              <span className="self-check__label">Đoạn cần xem lại</span>
              <div>
                {result.weak_ranges.map(([start]) => (
                  <button
                    key={start}
                    type="button"
                    className="coverage-notice__range"
                    title={`Tua tới ${formatTime(start)}`}
                    onClick={() => onSeek?.(start)}
                  >
                    {formatTime(start)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {renderItems('recall', result.recall)}
          {renderItems('ideas', result.ideas)}

          <label className="self-check__reminder">
            <input
              type="checkbox"
              checked={reviewEnabled}
              onChange={(event) => void toggleReminder(event.target.checked)}
            />
            <span>
              Nhắc tôi ôn lại
              {reviewEnabled && nextReviewAt && (
                <small> · lần nhắc tiếp theo {formatWhen(nextReviewAt)}</small>
              )}
            </span>
          </label>

          <div className="self-check__actions">
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={busy}
              onClick={() => void start(attempt + 1)}
            >
              {busy ? 'Đang chuẩn bị…' : 'Làm lại lần khác'}
            </button>
            <button type="button" className="btn btn--outline btn--sm" onClick={onClose}>
              Đóng
            </button>
          </div>
        </>
      )}
    </div>
  )
}
