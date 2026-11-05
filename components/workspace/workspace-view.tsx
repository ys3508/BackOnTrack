"use client"

import { useState } from "react"
import {
  CalendarDays,
  Check,
  ChevronRight,
  LifeBuoy,
  Play,
  Shuffle,
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
import { nowIso, useStore } from "@/components/workspace/store"
import { deadlineText, formatDateTime } from "@/lib/workspace/dates"
import type { Task } from "@/lib/workspace/schemas"
import {
  deadlinePassed,
  nextActionFor,
  recentActions,
  recommendTask,
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

export function WorkspaceView() {
  const { state, today, navigate, dispatch } = useStore()
  const startFocus = useStartFocus()
  const defaultMinutes = state.settings.defaultFocusMinutes
  const limit = state.settings.homeListSize
  const recommended = recommendTask(state, today)
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
          {recommended ? "Your one next thing" : "What’s on your plate?"}
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
              className="min-h-8 rounded-md text-left text-sm font-medium text-sage underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              {recommended.title}
            </button>
            <DeadlineChip task={recommended} />
          </div>
          <p className="mt-2 font-heading text-[1.625rem] leading-tight sm:text-[2rem]">
            {nextActionFor(recommended)}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              size="xl"
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
