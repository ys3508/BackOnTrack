/** Sorts a task into a family of Demo Mode templates, by its wording. */
export type Category = "academic" | "job" | "message" | "admin" | "general"

export function categorize(text: string): Category {
  const value = text.toLowerCase()
  if (
    /\b(homework|assignment|essay|paper|thesis|exams?|class|course|professor|study|lab report|syllabus|quiz|midterm|final)\b/.test(
      value
    )
  ) {
    return "academic"
  }
  if (
    /\b(jobs?|appl(y|ying|ication|ications)|resume|résumé|cover letter|interview)\b/.test(
      value
    )
  ) {
    return "job"
  }
  if (
    /\b(email|e-mail|reply|respond|message|call back|text back)\b/.test(value)
  ) {
    return "message"
  }
  if (
    /\b(tax(es)?|bills?|forms?|insurance|rent|appointment|visa|paperwork|renew)\b/.test(
      value
    )
  ) {
    return "admin"
  }
  return "general"
}
