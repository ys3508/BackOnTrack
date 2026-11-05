"use client"

import { useState } from "react"
import {
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  LifeBuoy,
  Play,
  Shuffle,
  Sparkles,
  Timer,
} from "lucide-react"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { useStartFocus } from "@/components/workspace/focus-view"
import {
  DeadlineChip,
  ExpandableList,
  StatusBadge,
} from "@/components/workspace/parts"
import { QuickAdd } from "@/components/workspace/quick-add"
import { ReplanDialog } from "@/components/workspace/schedule"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { SAMPLE_TASKS } from "@/lib/demo/sample-tasks"
import { deadlineText, formatDateTime } from "@/lib/workspace/dates"
import type { Task } from "@/lib/workspace/schemas"
import {
  deadlinePassed,
  nextActionFor,
  recentActions,
  recommendTask,
  resumeTask,
  stepCounts,
  tasksNeedingAttention,
  upcomingDeadlines,
} from "@/lib/workspace/selectors"

export function TaskRow({
  task,
  detail,
  action,
}: {
  task: Task
  detail?: React.ReactNode
  action?: React.ReactNode
}) {
  const { navigate } = useStore()
  return (
    <li className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={() => navigate({ view: "task", id: task.id })}
        className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left transition-colors outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">
            {task.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {detail ?? <DeadlineChip task={task} />}
          </span>
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </button>
      {action}
    </li>
  )
}

/** The full list stays out of the way until someone asks for it. */
function NextStepDetails({ task }: { task: Task }) {
  const [open, setOpen] = useState(false)
  const { done, total } = stepCounts(task)
  if (!total) return null
  return (
    <div className="mt-2">
      <p className="text-sm text-muted-foreground">
        You completed {done} of {total} steps for {task.title}.
      </p>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="min-h-11 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        {open ? "Hide all steps" : "See all steps"}
      </button>
      {open && (
        <ol className="mb-2 space-y-1 text-sm">
          {task.subtasks.map((sub) => (
            <li
              key={sub.id}
              className={
                sub.done ? "text-muted-foreground line-through" : undefined
              }
            >
              {sub.title}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function WorkspaceView() {
  const { state, today, navigate, dispatch } = useStore()
  const startFocus = useStartFocus()
  const defaultMinutes = state.settings.defaultFocusMinutes
  const limit = state.settings.homeListSize
  const skipped = state.skipped.date === today ? state.skipped.taskIds : []
  const resume = resumeTask(state)
  const resuming = resume && !skipped.includes(resume.id) ? resume : null
  const recommended = resuming ?? recommendTask(state, today)
  const attention = tasksNeedingAttention(state, today, recommended?.id)
  const upcoming = upcomingDeadlines(state, today).filter(
    (task) => task.id !== recommended?.id
  )
  const recent = recentActions(state)
  const hasTasks = state.tasks.length > 0
  const [replanning, setReplanning] = useState<Task | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <ScreenHeading>
          {resuming
            ? "Continue where you left off"
            : recommended
              ? "Your next small step"
              : "What’s on your plate?"}
        </ScreenHeading>
        {!recommended && (
          <p className="mt-2 text-muted-foreground">
            {hasTasks
              ? "Nothing is waiting right now. Add something, or take a break."
              : "Add one task to begin. A few words are enough."}
          </p>
        )}
      </div>

      {recommended && (
        <Card className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate({ view: "task", id: recommended.id })}
              className="min-h-11 rounded-md text-left text-sm font-medium text-sage underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              {recommended.title}
            </button>
            <DeadlineChip task={recommended} />
          </div>
          <p className="mt-2 font-heading text-[1.625rem] leading-tight sm:text-[2rem]">
            {nextActionFor(recommended)}
          </p>
          <NextStepDetails task={recommended} />
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              size="xl"
              onClick={() =>
                navigate({
                  view: "task",
                  id: recommended.id,
                  section:
                    recommended.subtasks.length || recommended.workDoc
                      ? "help"
                      : "setup",
                })
              }
            >
              <Sparkles aria-hidden />
              {recommended.subtasks.length || recommended.workDoc
                ? "Help me do this"
                : "Set up my workspace"}
            </Button>
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => startFocus(recommended.id, defaultMinutes)}
            >
              <Play aria-hidden />
              Start {defaultMinutes} minutes
            </Button>
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() =>
                dispatch({
                  type: "complete-next-action",
                  id: recommended.id,
                  at: nowIso(),
                })
              }
            >
              <Check aria-hidden />
              Done
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={() =>
                dispatch({
                  type: "skip-recommendation",
                  taskId: recommended.id,
                  date: today,
                })
              }
            >
              <Shuffle aria-hidden />
              Something else
            </Button>
            {resuming && (
              <Button
                type="button"
                size="xl"
                variant="ghost"
                onClick={() =>
                  navigate({
                    view: "task",
                    id: recommended.id,
                    section: "doc",
                  })
                }
              >
                <FileText aria-hidden />
                Open my document
              </Button>
            )}
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={() =>
                navigate({ view: "recover", taskId: recommended.id })
              }
            >
              <LifeBuoy aria-hidden />
              I’m stuck
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-sans text-[15px] font-semibold tracking-normal">
          Quick add
        </h2>
        <QuickAdd />
        {!hasTasks && (
          <div className="mt-3">
            <p className="mb-2 text-sm text-muted-foreground">
              Or try an example:
            </p>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_TASKS.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => {
                    const id = newId()
                    sample
                      .build(id, nowIso(), today)
                      .forEach((action) => dispatch(action))
                    navigate({ view: "task", id })
                  }}
                  className="min-h-11 rounded-full border border-border bg-card px-3.5 py-2 text-left text-sm transition-colors outline-none hover:border-primary/50 hover:bg-sage-soft focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => navigate({ view: "focus" })}
          >
            <Timer aria-hidden />
            Start Focus
          </Button>
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => navigate({ view: "recover" })}
          >
            <LifeBuoy aria-hidden />
            Recover a Task
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            onClick={() => navigate({ view: "calendar" })}
          >
            <CalendarDays aria-hidden />
            Calendar
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {attention.length > 0 && (
          <section aria-labelledby="attention-heading">
            <h2
              id="attention-heading"
              className="mb-2 font-sans text-[15px] font-semibold tracking-normal"
            >
              Could use a look
            </h2>
            <ExpandableList
              items={attention}
              limit={limit}
              label="tasks"
              render={(task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  detail={
                    <>
                      <StatusBadge status={task.status} />
                      <DeadlineChip task={task} />
                    </>
                  }
                  action={
                    deadlinePassed(task, today) ? (
                      <Button
                        type="button"
                        size="xl"
                        variant="outline"
                        className="h-auto"
                        aria-label={`Replan ${task.title}`}
                        onClick={() => setReplanning(task)}
                      >
                        Replan
                      </Button>
                    ) : undefined
                  }
                />
              )}
            />
          </section>
        )}

        {upcoming.length > 0 && (
          <section aria-labelledby="upcoming-heading">
            <h2
              id="upcoming-heading"
              className="mb-2 font-sans text-[15px] font-semibold tracking-normal"
            >
              Coming up
            </h2>
            <ExpandableList
              items={upcoming}
              limit={limit}
              label="deadlines"
              render={(task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  detail={
                    <span className="text-xs text-muted-foreground">
                      {deadlineText(task.deadline, today)}
                    </span>
                  }
                />
              )}
            />
          </section>
        )}

        {recent.length > 0 && (
          <section aria-labelledby="recent-heading">
            <h2
              id="recent-heading"
              className="mb-2 font-sans text-[15px] font-semibold tracking-normal"
            >
              Recently done
            </h2>
            <ul className="space-y-1.5 text-sm">
              {recent.map(({ task, event }) => (
                <li key={`${task.id}-${event.id}`} className="flex gap-2">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-sage"
                    aria-hidden
                  />
                  <span className="min-w-0 break-words">
                    {event.text}
                    <span className="block text-xs text-muted-foreground">
                      {task.title} · {formatDateTime(event.at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <ReplanDialog task={replanning} onClose={() => setReplanning(null)} />
    </div>
  )
}
