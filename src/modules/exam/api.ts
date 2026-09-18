import { api } from '@/platform/api/client'

/**
 * Oral exam preparation: a course, the materials the student hands over, and the
 * analysis the questions are built from (`backend/app/modules/exam`).
 *
 * The student classifies nothing and configures nothing: every field below that
 * describes the material or the exam is worked out on the server.
 */

/** How the exam is run. `unknown` is a real answer — it means "decide for me". */
export type ExamStyle = 'oral_questions' | 'board_work' | 'unknown'

export type MaterialType =
  | 'lecture_slides'
  | 'lecture_notes'
  | 'textbook'
  | 'personal_notes'
  | 'syllabus'
  | 'past_exam'
  | 'problem_set'
  | 'other'

/** Mirrors `MATERIAL_LABELS` in `backend/app/modules/exam/catalogs.py`. */
export const MATERIAL_LABELS: Record<MaterialType, string> = {
  lecture_slides: 'Lecture slides',
  lecture_notes: 'Lecture notes',
  textbook: 'Textbook',
  personal_notes: 'Your notes',
  syllabus: 'Syllabus',
  past_exam: 'Previous exam',
  problem_set: 'Problem set',
  other: 'Course material',
}

export const materialLabel = (type?: string | null): string =>
  MATERIAL_LABELS[(type ?? 'other') as MaterialType] ?? MATERIAL_LABELS.other

export interface Course {
  id: string
  subject: string
  status: 'draft' | 'analyzing' | 'ready' | 'failed'
  activeAnalysisId: string | null
  materialCount: number
  /** The student's own answer about the format, when they gave one. */
  chosenStyle: ExamStyle | null
}

export interface Material {
  id: string
  source: 'file' | 'link' | 'text'
  name: string
  url?: string | null
  status: 'processing' | 'ready' | 'failed'
  failureReason?: string | null
  /** A first guess while reading, replaced by the analyst's own reading of the content. */
  detectedType?: MaterialType | null
  detectedTitle?: string | null
  sizeBytes?: number | null
}

export interface AnalysisTopic {
  name: string
  importance: 'high' | 'medium' | 'low'
  why: string
  subtopics: string[]
  sourceMaterialIds: string[]
}

/** What the analyst has worked out so far (streamed while it works; not final). */
export interface AnalysisProgress {
  stage: 'starting' | 'reading' | 'repair' | 'format' | 'done'
  summary: string
  topics: { name: string; importance: string }[]
  materials: { materialId: string; type: string; title: string }[]
  notes: string
  sources: { title: string; domain: string }[]
  /** The AI service is busy and the step will be retried automatically. */
  busy?: boolean
}

export interface Analysis {
  id: string
  status: 'queued' | 'analyzing' | 'ready' | 'failed'
  failureReason?: string
  progress?: AnalysisProgress | null
  courseSummary?: string
  scope?: string
  topics?: AnalysisTopic[]
  learningObjectives?: string[]
  likelyQuestions?: string[]
  examStyle?: ExamStyle
  examStyleConfidence?: 'high' | 'medium' | 'low'
  examStyleEvidence?: string
  examStyleSources?: { title: string; domain: string }[]
  materials?: { materialId: string; type: MaterialType; title: string; covers: string[] }[]
  caveats?: string[]
  /** What the exam will actually run as: the student's own answer wins over the inference. */
  effectiveStyle?: ExamStyle
}

/**
 * Whether asking the student how their exam is run would change the questions.
 * Mirrors `needs_exam_style` on the server: an exam the material settled is never
 * asked about again.
 */
export function shouldAskStyle(analysis: Analysis | null, course: Course | null): boolean {
  if (!analysis || analysis.status !== 'ready') return false
  if (course?.chosenStyle) return false
  return analysis.examStyle === 'unknown' || !analysis.examStyle || analysis.examStyleConfidence === 'low'
}

/** The style an exam would start in right now. */
export const effectiveStyle = (analysis: Analysis | null, course: Course | null): ExamStyle =>
  course?.chosenStyle ?? analysis?.effectiveStyle ?? analysis?.examStyle ?? 'unknown'

export const createCourse = (subject: string) =>
  api<Course>('/exam/courses', { method: 'POST', body: { id: crypto.randomUUID(), subject } })

export const listCourses = () => api<Course[]>('/exam/courses')

export const getCourse = (courseId: string) => api<Course>(`/exam/courses/${courseId}`)

export const deleteCourse = (courseId: string) => api<void>(`/exam/courses/${courseId}`, { method: 'DELETE' })

export const listMaterials = (courseId: string) => api<Material[]>(`/exam/courses/${courseId}/materials`)

export function uploadMaterial(courseId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<Material>(`/exam/courses/${courseId}/materials`, { method: 'POST', body: form })
}

export const addMaterialLink = (courseId: string, url: string, title = '') =>
  api<Material>(`/exam/courses/${courseId}/materials/link`, {
    method: 'POST',
    body: { id: crypto.randomUUID(), url, title },
  })

export const addMaterialText = (courseId: string, text: string, title = '') =>
  api<Material>(`/exam/courses/${courseId}/materials/text`, {
    method: 'POST',
    body: { id: crypto.randomUUID(), text, title },
  })

export const deleteMaterial = (courseId: string, materialId: string) =>
  api<void>(`/exam/courses/${courseId}/materials/${materialId}`, { method: 'DELETE' })

export const analyseCourse = (courseId: string) =>
  api<{ analysisId: string; status: string }>(`/exam/courses/${courseId}/analyses:generate`, { method: 'POST' })

export const getAnalysis = (courseId: string, analysisId: string) =>
  api<Analysis>(`/exam/courses/${courseId}/analyses/${analysisId}`)

/** The student's own answer to the one question the app may ask. */
export const setExamStyle = (courseId: string, style: ExamStyle) =>
  api<Course>(`/exam/courses/${courseId}/style`, { method: 'PUT', body: { style } })

export const createExamSession = (body: {
  courseId?: string
  analysisId?: string
  style?: ExamStyle
  durationMinutes: number
}) =>
  api<{ id: string; maxDurationMs: number; examStyle: ExamStyle }>('/exam/sessions', {
    method: 'POST',
    body: { id: crypto.randomUUID(), ...body },
  })

/** Sit the same exam again: same course, new questions, aimed at what went weakest. */
export const retryExamSession = (sessionId: string) =>
  api<{ id: string; maxDurationMs: number; examStyle: ExamStyle }>(`/exam/sessions/${sessionId}/retry`, {
    method: 'POST',
    body: { id: crypto.randomUUID() },
  })
