"use client"

import { useState } from "react"
import {
  ArrowLeft,
  LifeBuoy,
  Check,
  Copy,
  Pause,
  Play,
  Plus,
  Timer,
  Trash2,
} from "lucide-react"

import { useAiConsent } from "@/components/workspace/ai-consent"
import { BreakdownPanel } from "@/components/workspace/breakdown-panel"
import { InstructionsPanel } from "@/components/workspace/instructions-panel"
import { WritingAssist } from "@/components/workspace/writing-assist"
import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  FOCUS_OPTIONS,
  SessionList,
  useStartFocus,
} from "@/components/workspace/focus-view"
import {
  ConfirmDialog,
  DeadlineChip,
  ProgressBar,
  StatusBadge,
  fieldClass,
} from "@/components/workspace/parts"
import {
  PlanSessionForm,
  PlannedSessionRow,
  ReplanDialog,
} from "@/components/workspace/schedule"
import { ReleaseDialog, useStatusChange } from "@/components/workspace/status"
import {
  WorkingEditor,
  useWorkingEditor,
} from "@/components/workspace/working-editor"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { formatDateTime, shortDate } from "@/lib/workspace/dates"
import {
  currentSubtask,
  deadlinePassed,
  nextActionFor,
  progressSummary,
} from "@/lib/workspace/selectors"
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TASK_STATUSES,
  isActive,
} from "@/lib/workspace/schemas"
import type {
  Priority,
  Task,
  TaskDocument,
  TaskEvent,
  TaskStatus,
} from "@/lib/workspace/schemas"

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-sans text-[15px] font-semibold tracking-normal">
      {children}
    </h2>
  )
}

export function TaskDetail({
  id,
  focusDocument = false,
}: {
  id: string
  focusDocument?: boolean
}) {
  const { state, navigate } = useStore()
  const task = state.tasks.find((item) => item.id === id)

  if (!task) {
    return (
      <div className="text-center">
        <ScreenHeading>This task isn’t here anymore</ScreenHeading>
        <Button
          type="button"
          size="xl"
          className="mt-4"
          onClick={() => navigate({ view: "tasks" })}
        >
          See all tasks
        </Button>
      </div>
    )
  }
  return <TaskBody key={task.id} task={task} focusDocument={focusDocument} />
}

function TaskBody({
  task,
  focusDocument,
}: {
  task: Task
  focusDocument: boolean
}) {
  const { dispatch, navigate } = useStore()
  const statusChange = useStatusChange()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { editor, dirty } = useWorkingEditor(task, focusDocument)
  const consent = useAiConsent(task)

  const setStatus = (status: TaskStatus) => statusChange.request(task, status)

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => navigate({ view: "tasks" })}
        className="flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All tasks
      </button>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <StatusBadge status={task.status} />
          <ScreenHeading className="mt-2 break-words">
            {task.title}
          </ScreenHeading>
        </div>
        <div className="flex flex-wrap gap-2">
          {isActive(task) && (
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => setStatus("completed")}
            >
              <Check aria-hidden />
              Mark complete
            </Button>
          )}
          {task.status === "paused" ? (
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => setStatus("in-progress")}
            >
              <Play aria-hidden />
              Resume
            </Button>
          ) : (
            isActive(task) && (
              <Button
                type="button"
                size="xl"
                variant="ghost"
                onClick={() => setStatus("paused")}
              >
                <Pause aria-hidden />
                Pause
              </Button>
            )
          )}
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          {isActive(task) && <CurrentStepCard task={task} />}
          <InstructionsPanel task={task} />
          <BreakdownPanel task={task} guard={consent.guard} />
        </div>
        <div className="space-y-4">
          {isActive(task) && <FocusCard task={task} />}
          <WorkingEditor task={task} editor={editor} dirty={dirty} />
          <WritingAssist task={task} editor={editor} guard={consent.guard} />
        </div>
      </div>

      <details className="group rounded-2xl border border-border bg-card">
        <summary className="flex min-h-12 cursor-pointer items-center px-5 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/30">
          More about this task
        </summary>
        <div className="space-y-4 border-t border-border p-4">
          <NextActionCard task={task} />
          <ProgressCard task={task} />
          <DetailsCard task={task} onStatus={setStatus} />
          <ScheduleCard task={task} />
          <DocumentsCard task={task} />
          <FocusHistoryCard task={task} />
          <HistoryCard task={task} />
          <Button
            type="button"
            size="xl"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden />
            Delete task
          </Button>
        </div>
      </details>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this task?"
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          dispatch({ type: "delete-task", id: task.id })
          navigate({ view: "tasks" })
        }}
      >
        This removes the task, its steps, document, history, and planned work
        sessions. It can’t be undone.
      </ConfirmDialog>
      <ReleaseDialog {...statusChange.dialog} />
      {consent.dialog}
    </div>
  )
}

function CurrentStepCard({ task }: { task: Task }) {
  const { dispatch, navigate } = useStore()
  const hasStep = Boolean(task.nextAction || currentSubtask(task))
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-medium text-sage">Right now</h2>
        <DeadlineChip task={task} />
      </div>
      <p className="font-heading text-[1.5rem] leading-snug">
        {nextActionFor(task)}
      </p>
      {task.progress > 0 && (
        <ProgressBar value={task.progress} label="Task progress" />
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {hasStep && (
          <Button
            type="button"
            size="xl"
            onClick={() =>
              dispatch({
                type: "complete-next-action",
                id: task.id,
                at: nowIso(),
              })
            }
          >
            <Check aria-hidden />
            Mark this step done
          </Button>
        )}
        <Button
          type="button"
          size="xl"
          variant={task.status === "needs-recovery" ? "default" : "outline"}
          onClick={() => navigate({ view: "recover", taskId: task.id })}
        >
          <LifeBuoy aria-hidden />
          {task.recovery ? "See your recovery plan" : "I’m stuck"}
        </Button>
      </div>
    </Card>
  )
}

function NextActionCard({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const [value, setValue] = useState(task.nextAction)
  const [lastSeen, setLastSeen] = useState(task.nextAction)
  if (task.nextAction !== lastSeen) {
    setLastSeen(task.nextAction)
    setValue(task.nextAction)
  }

  const save = () => {
    if (value.trim() !== task.nextAction) {
      dispatch({
        type: "edit-task",
        id: task.id,
        at: nowIso(),
        patch: { nextAction: value.trim() },
      })
    }
  }

  return (
    <Card>
      <label htmlFor="next-action">
        <SectionTitle>Next action</SectionTitle>
      </label>
      <Input
        id="next-action"
        value={value}
        maxLength={300}
        placeholder="One small, concrete thing"
        onChange={(event) => setValue(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save()
        }}
        className="mt-2 h-11"
      />
      {task.nextAction && (
        <Button
          type="button"
          size="xl"
          variant="outline"
          className="mt-2"
          onClick={() =>
            dispatch({
              type: "complete-next-action",
              id: task.id,
              at: nowIso(),
            })
          }
        >
          <Check aria-hidden />
          Done with this action
        </Button>
      )}
    </Card>
  )
}

function FocusCard({ task }: { task: Task }) {
  const { state, navigate } = useStore()
  const start = useStartFocus()
  const running = state.timer?.taskId === task.id
  return (
    <Card>
      <SectionTitle>Focus on this</SectionTitle>
      {running ? (
        <Button
          type="button"
          size="xl"
          className="mt-2"
          onClick={() => navigate({ view: "focus" })}
        >
          <Timer aria-hidden />
          Open the running timer
        </Button>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {FOCUS_OPTIONS.map((option, index) => (
            <Button
              key={option.minutes}
              type="button"
              size="xl"
              variant={index === 0 ? "default" : "outline"}
              className="h-auto min-h-12 py-2 whitespace-normal"
              onClick={() => start(task.id, option.minutes)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </Card>
  )
}

function ScheduleCard({ task }: { task: Task }) {
  const { state, today } = useStore()
  const [replanning, setReplanning] = useState(false)
  const planned = state.planned.filter((item) => item.taskId === task.id)
  return (
    <Card className="space-y-3">
      <SectionTitle>Planned work</SectionTitle>
      {deadlinePassed(task, today) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sand-soft p-3 text-sm text-sand">
          <span>
            The deadline was {task.deadline && shortDate(task.deadline)}. What
            now is up to you.
          </span>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={() => setReplanning(true)}
          >
            Replan
          </Button>
        </div>
      )}
      {planned.length > 0 && (
        <ul className="space-y-2">
          {planned.map((session) => (
            <PlannedSessionRow key={session.id} session={session} />
          ))}
        </ul>
      )}
      <PlanSessionForm taskId={task.id} idPrefix="task-plan" />
      <ReplanDialog
        task={replanning ? task : null}
        onClose={() => setReplanning(false)}
      />
    </Card>
  )
}

function FocusHistoryCard({ task }: { task: Task }) {
  const { state } = useStore()
  const sessions = state.focusSessions.filter(
    (session) => session.taskId === task.id
  )
  if (!sessions.length) return null
  return (
    <Card>
      <SectionTitle>Focus sessions</SectionTitle>
      <div className="mt-2">
        <SessionList sessions={sessions} />
      </div>
    </Card>
  )
}

function ProgressCard({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const setProgress = (progress: number) =>
    dispatch({ type: "set-progress", id: task.id, at: nowIso(), progress })
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <label htmlFor="task-progress">
          <SectionTitle>Progress</SectionTitle>
        </label>
        <span className="text-sm text-muted-foreground">{task.progress}%</span>
      </div>
      <input
        id="task-progress"
        type="range"
        min={0}
        max={100}
        step={5}
        value={task.progress}
        onChange={(event) => setProgress(Number(event.target.value))}
        className="mt-3 h-6 w-full accent-[var(--primary)]"
      />
    </Card>
  )
}

function DetailsCard({
  task,
  onStatus,
}: {
  task: Task
  onStatus: (status: TaskStatus) => void
}) {
  const { dispatch } = useStore()
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)

  return (
    <Card className="space-y-3">
      <SectionTitle>Details</SectionTitle>
      <div>
        <label htmlFor="task-title" className="mb-1 block text-sm font-medium">
          Title
        </label>
        <Input
          id="task-title"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const trimmed = title.trim()
            if (trimmed && trimmed !== task.title) {
              dispatch({
                type: "edit-task",
                id: task.id,
                at: nowIso(),
                patch: { title: trimmed },
              })
            } else setTitle(task.title)
          }}
          className="h-11"
        />
      </div>
      <div>
        <label
          htmlFor="task-description"
          className="mb-1 block text-sm font-medium"
        >
          Description
        </label>
        <Textarea
          id="task-description"
          value={description}
          maxLength={2000}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description.trim() !== task.description) {
              dispatch({
                type: "edit-task",
                id: task.id,
                at: nowIso(),
                patch: { description: description.trim() },
              })
            }
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label
            htmlFor="task-status"
            className="mb-1 block text-sm font-medium"
          >
            Status
          </label>
          <select
            id="task-status"
            value={task.status}
            onChange={(event) => onStatus(event.target.value as TaskStatus)}
            className={fieldClass}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="task-priority"
            className="mb-1 block text-sm font-medium"
          >
            Priority
          </label>
          <select
            id="task-priority"
            value={task.priority}
            onChange={(event) =>
              dispatch({
                type: "edit-task",
                id: task.id,
                at: nowIso(),
                patch: { priority: event.target.value as Priority },
              })
            }
            className={fieldClass}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABEL[priority]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="task-deadline"
            className="mb-1 block text-sm font-medium"
          >
            Deadline
          </label>
          <input
            id="task-deadline"
            type="date"
            max="9999-12-31"
            value={task.deadline ?? ""}
            onChange={(event) =>
              dispatch({
                type: "set-deadline",
                id: task.id,
                at: nowIso(),
                deadline: event.target.value || null,
              })
            }
            className={fieldClass}
          />
        </div>
      </div>
      {task.originalDeadline && task.originalDeadline !== task.deadline && (
        <p className="text-sm text-muted-foreground">
          Original deadline: {shortDate(task.originalDeadline)}
        </p>
      )}
    </Card>
  )
}

function DocumentsCard({ task }: { task: Task }) {
  const { dispatch } = useStore()
  return (
    <Card>
      <SectionTitle>Drafts and notes</SectionTitle>
      <div className="mt-2 space-y-3">
        {task.documents.map((doc) => (
          <DocumentEditor key={doc.id} task={task} doc={doc} />
        ))}
      </div>
      <Button
        type="button"
        size="xl"
        variant="outline"
        className="mt-2"
        onClick={() =>
          dispatch({
            type: "save-document",
            id: task.id,
            at: nowIso(),
            docId: newId(),
            title: "Notes",
            body: "",
          })
        }
      >
        <Plus aria-hidden />
        Add a note
      </Button>
    </Card>
  )
}

function DocumentEditor({ task, doc }: { task: Task; doc: TaskDocument }) {
  const { dispatch } = useStore()
  const [title, setTitle] = useState(doc.title)
  const [body, setBody] = useState(doc.body)
  const [copied, setCopied] = useState(false)
  const [added, setAdded] = useState(false)

  const save = () => {
    if (title !== doc.title || body !== doc.body) {
      dispatch({
        type: "save-document",
        id: task.id,
        at: nowIso(),
        docId: doc.id,
        title: title.trim() || "Notes",
        body,
      })
    }
  }

  return (
    <div className="rounded-xl border border-border p-3">
      <label className="sr-only" htmlFor={`doc-title-${doc.id}`}>
        Document title
      </label>
      <Input
        id={`doc-title-${doc.id}`}
        value={title}
        maxLength={120}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={save}
        className="h-10 border-transparent bg-transparent px-1 font-medium"
      />
      <label className="sr-only" htmlFor={`doc-body-${doc.id}`}>
        {doc.title}
      </label>
      <Textarea
        id={`doc-body-${doc.id}`}
        value={body}
        maxLength={8000}
        onChange={(event) => setBody(event.target.value)}
        onBlur={save}
        className="mt-1 min-h-28"
      />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(body)
              setCopied(true)
            } catch {
              setCopied(false)
            }
          }}
        >
          <Copy aria-hidden />
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          disabled={added || !body.trim()}
          onClick={() => {
            dispatch({
              type: "append-to-doc",
              id: task.id,
              at: nowIso(),
              text: body,
              label: title,
            })
            setAdded(true)
          }}
        >
          {added ? "Added to working document" : "Add to working document"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="text-muted-foreground"
          onClick={() =>
            dispatch({
              type: "delete-document",
              id: task.id,
              at: nowIso(),
              docId: doc.id,
            })
          }
        >
          <Trash2 aria-hidden />
          Delete
        </Button>
        {doc.source !== "user" && (
          <span className="text-xs text-muted-foreground">
            {doc.source === "live"
              ? "Started from a live AI draft"
              : "Started from a Demo Mode template"}
          </span>
        )}
      </div>
    </div>
  )
}

const KIND_LABEL: Partial<Record<TaskEvent["kind"], string>> = {
  suggested: "Suggested",
  accepted: "Accepted",
  attempted: "Tried",
  completed: "Done",
}

const KIND_STYLE: Partial<Record<TaskEvent["kind"], string>> = {
  suggested: "bg-indigo-soft text-indigo",
  accepted: "bg-secondary text-foreground",
  attempted: "bg-sand-soft text-sand",
  completed: "bg-sage-soft text-sage",
}

function HistoryCard({ task }: { task: Task }) {
  const { state } = useStore()
  const [expanded, setExpanded] = useState(false)
  const events = [...task.history].sort((a, b) => b.at.localeCompare(a.at))
  const shown = expanded ? events : events.slice(0, 5)
  const summary = progressSummary(task, state)
  return (
    <Card>
      <SectionTitle>History</SectionTitle>
      {summary && (
        <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
      )}
      <ol className="mt-2 space-y-2 text-sm">
        {shown.map((event) => (
          <li key={event.id}>
            {KIND_LABEL[event.kind] && (
              <span
                className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLE[event.kind]}`}
              >
                {KIND_LABEL[event.kind]}
              </span>
            )}
            <span className="break-words">{event.text}</span>
            <span className="block text-xs text-muted-foreground">
              {formatDateTime(event.at)}
            </span>
          </li>
        ))}
      </ol>
      {events.length > 5 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="mt-2 min-h-11 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {expanded ? "Show less" : `Show all ${events.length}`}
        </button>
      )}
    </Card>
  )
}
