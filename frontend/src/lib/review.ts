/** ADR 0014 self-check API and the one pure helper the UI needs. */

import { apiFetch } from './api'
import { lectureDuration, minuteRangesFromTimes } from './coverage'

export interface QuizTarget {
  id: string
  time: number | null
  parent: string
}

export interface IdeaQuestion {
  id: string
  prompt: string
}

export interface QuizPayload {
  attempt: number
  quiz_id: string
  targets: QuizTarget[]
  questions: IdeaQuestion[]
  ideas_available: boolean
  note: string | null
}

export interface AttemptItem {
  id: string
  prompt: string
  answer: string
  key: string
  correct: boolean
  original: boolean
  overridden: boolean
}

export interface ResultFraction {
  id: string
  asked: number
  correct: number
  overridden: number
  items: AttemptItem[]
}

export interface AttemptResult {
  recall: ResultFraction
  ideas: ResultFraction
  weak_ranges: Array<[number, number]>
  next_review_at: string | null
  message: string
}

export interface ReviewState {
  enabled: boolean
  next_review_at: string | null
}

export interface DueProject {
  id: string
  title: string
  node_count: number
  next_review_at: string
}

export function getQuiz(projectId: string, attempt: number): Promise<QuizPayload> {
  return apiFetch<QuizPayload>(`/projects/${projectId}/quiz`, {
    method: 'POST',
    body: { attempt },
  })
}

export function submitAttempt(
  projectId: string,
  body: {
    quiz_id: string
    attempt: number
    recall: Array<{ node_id: string; answer: string }>
    ideas: Array<{ id: string; answer: string }>
    weak_ranges: Array<[number, number]>
  },
): Promise<AttemptResult> {
  return apiFetch<AttemptResult>(`/projects/${projectId}/attempt`, { method: 'POST', body })
}

export function overrideMark(
  attemptId: string,
  itemId: string,
  correct: boolean,
): Promise<ResultFraction> {
  return apiFetch<ResultFraction>(`/review/attempts/${attemptId}`, {
    method: 'PATCH',
    body: { item_id: itemId, correct },
  })
}

export function setReview(projectId: string, enabled: boolean): Promise<ReviewState> {
  return apiFetch<ReviewState>(`/projects/${projectId}/review`, {
    method: 'PATCH',
    body: { enabled },
  })
}

export function dueProjects(): Promise<DueProject[]> {
  return apiFetch<DueProject[]>('/review/due')
}

function normalizedWords(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2)
}

/** Navigation hint only: did any meaningful word survive in the answer?
 * Grading stays on the server; this just decides which minutes to offer as
 * "xem lại". An empty answer is always a miss; an untimed node has no bucket. */
export function likelyMissed(answer: string, expected: string): boolean {
  const given = normalizedWords(answer)
  if (given.length === 0) return true
  const key = new Set(normalizedWords(expected))
  return key.size > 0 && !given.some((word) => key.has(word))
}

/** Minute ranges where the learner missed a branch, from the same buckets the
 * "phút trống" hint uses. Timed nodes only — an untimed miss has no place to jump. */
export function weakRangesFromMisses(
  misses: Array<{ time: number | null }>,
  cues: Array<{ start: number; duration: number }>,
): Array<[number, number]> {
  const duration = lectureDuration(cues)
  if (duration <= 0) return []
  return minuteRangesFromTimes(
    misses.map((miss) => miss.time).filter((time): time is number => typeof time === 'number'),
    duration,
  ).map((range): [number, number] => [range.start, range.end])
}
