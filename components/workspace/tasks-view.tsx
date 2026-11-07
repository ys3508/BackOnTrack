"use client"

import { useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { Announcements, DragEndEvent } from "@dnd-kit/core"
import { Check, ChevronRight, Columns3, GripVertical, List } from "lucide-react"

import { ScreenHeading } from "@/components/shared"
import {
  DeadlineChip,
  PriorityChip,
  ProgressBar,
  StatusBadge,
  fieldClass,
} from "@/components/workspace/parts"
import { QuickAdd } from "@/components/workspace/quick-add"
import { ReleaseDialog, useStatusChange } from "@/components/workspace/status"
import { useStore } from "@/components/workspace/store"
import { rankTasks } from "@/lib/planning/priority"
import { STATUS_LABEL, TASK_STATUSES, isActive } from "@/lib/workspace/schemas"
import type { Task, TaskStatus } from "@/lib/workspace/schemas"
import { taskColorVars } from "@/lib/calendar/task-colors"
import { cn } from "@/lib/utils"

type Filter = "active" | "done" | "all"

const FILTERS: { value: Filter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "done", label: "Finished" },
  { value: "all", label: "All" },
]

export function TasksView() {
  const { state, today } = useStore()
  const [ordering, setOrdering] = useState<"suggested" | "added">("suggested")
  const [layout, setLayout] = useState<"list" | "board">("list")
  const [filter, setFilter] = useState<Filter>("active")
  const statusChange = useStatusChange()

  const visible = state.tasks.filter((task) =>
    filter === "all"
      ? true
      : filter === "active"
        ? isActive(task)
        : !isActive(task)
  )

  const ranked = rankTasks(state, today)
  const place = (task: Task) => {
    const index = ranked.findIndex((entry) => entry.task.id === task.id)
    return index < 0 ? ranked.length : index
  }
  const shown =
    ordering === "suggested" && filter === "active"
      ? [...visible].sort((a, b) => place(a) - place(b))
      : visible

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ScreenHeading>Tasks</ScreenHeading>
        <div
          role="group"
          aria-label="Task layout"
          className="flex rounded-[1rem] border border-line bg-card p-1 text-sm font-medium"
        >
          {(
            [
              { value: "list", label: "List", Icon: List },
              { value: "board", label: "Board", Icon: Columns3 },
            ] as const
          ).map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={layout === value}
              onClick={() => setLayout(value)}
              className={cn(
                "flex min-h-10 items-center gap-1.5 rounded-md px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                layout === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      <QuickAdd showDetails />

      {layout === "list" ? (
        <>
          <div role="group" aria-label="Filter tasks" className="flex gap-1.5">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={cn(
                  "min-h-10 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                  filter === option.value
                    ? "border-transparent bg-primary font-medium text-primary-foreground"
                    : "border-border bg-card"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {filter === "active" && (
            <div
              role="group"
              aria-label="Order tasks"
              className="flex items-center gap-1.5"
            >
              <span className="text-sm text-muted-foreground">Order:</span>
              {(
                [
                  { value: "suggested", label: "Suggested" },
                  { value: "added", label: "As added" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={ordering === option.value}
                  onClick={() => setOrdering(option.value)}
                  className={cn(
                    "min-h-10 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                    ordering === option.value
                      ? "border-transparent bg-primary font-medium text-primary-foreground"
                      : "border-border bg-card"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {visible.length ? (
            <ul className="space-y-2">
              {shown.map((task) => (
                <TaskListItem
                  key={task.id}
                  task={task}
                  onStatus={statusChange.request}
                  reason={
                    ordering === "suggested" && filter === "active"
                      ? ranked
                          .find((entry) => entry.task.id === task.id)
                          ?.reasons.join(". ")
                      : undefined
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing here.
            </p>
          )}
        </>
      ) : (
        <Board tasks={state.tasks} onStatus={statusChange.request} />
      )}

      <ReleaseDialog {...statusChange.dialog} />
    </div>
  )
}

function TaskListItem({
  task,
  onStatus,
  reason,
}: {
  task: Task
  onStatus: (task: Task, status: TaskStatus) => void
  reason?: string
}) {
  const { navigate } = useStore()
  const done = task.status === "completed"
  return (
    <li
      style={{
        ...taskColorVars(task.id, task.focusTheme),
        background: "var(--task-wash)",
      }}
      className="rounded-2xl border border-line p-3.5"
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-label={
            done ? `Reopen ${task.title}` : `Mark ${task.title} complete`
          }
          aria-pressed={done}
          onClick={() => onStatus(task, done ? "in-progress" : "completed")}
          className="group -my-1 -ml-2 grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <span
            aria-hidden
            className={cn(
              "grid size-7 place-items-center rounded-full border",
              done
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input group-hover:border-primary/60"
            )}
          >
            {done && <Check className="size-4" />}
          </span>
        </button>
        <button
          type="button"
          onClick={() => navigate({ view: "task", id: task.id })}
          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <span className="block font-medium break-words">{task.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <StatusBadge status={task.status} />
            <DeadlineChip task={task} />
            <PriorityChip task={task} />
          </span>
          {reason && (
            <span className="mt-1 block text-sm text-muted-foreground">
              Why here: {reason}.
            </span>
          )}
          {task.progress > 0 && (
            <ProgressBar
              value={task.progress}
              label={`Progress on ${task.title}`}
              className="mt-2"
            />
          )}
        </button>
        <ChevronRight
          className="mt-1 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </div>
    </li>
  )
}

function Board({
  tasks,
  onStatus,
}: {
  tasks: Task[]
  onStatus: (task: Task, status: TaskStatus) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  function handleDragEnd({ active, over }: DragEndEvent) {
    const task = tasks.find((item) => item.id === active.id)
    if (task && over && over.id !== task.status) {
      onStatus(task, over.id as TaskStatus)
    }
  }

  const titleOf = (id: unknown) =>
    tasks.find((task) => task.id === id)?.title ?? "task"
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${titleOf(active.id)} is over ${STATUS_LABEL[over.id as TaskStatus]}.`
        : `${titleOf(active.id)} is not over a column.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Moved ${titleOf(active.id)} to ${STATUS_LABEL[over.id as TaskStatus]}.`
        : `${titleOf(active.id)} was returned to its column.`,
    onDragCancel: ({ active }) => `Cancelled moving ${titleOf(active.id)}.`,
  }

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements }}
    >
      <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-3 sm:-mx-6 sm:px-6 xl:grid xl:grid-cols-6 xl:overflow-visible">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={tasks.filter((task) => task.status === status)}
            onStatus={onStatus}
          />
        ))}
      </div>
    </DndContext>
  )
}

function Column({
  status,
  tasks,
  onStatus,
}: {
  status: TaskStatus
  tasks: Task[]
  onStatus: (task: Task, status: TaskStatus) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUS_LABEL[status]}, ${tasks.length} tasks`}
      className={cn(
        "w-64 shrink-0 snap-start rounded-2xl bg-secondary/70 p-2.5 transition-colors xl:w-auto",
        isOver && "bg-brand-soft"
      )}
    >
      <h2 className="mb-2 px-1 font-sans text-sm font-semibold tracking-normal">
        {STATUS_LABEL[status]}{" "}
        <span className="font-normal text-muted-foreground">
          {tasks.length}
        </span>
      </h2>
      <ul className="min-h-16 space-y-2">
        {tasks.map((task) => (
          <BoardCard key={task.id} task={task} onStatus={onStatus} />
        ))}
      </ul>
    </section>
  )
}

function BoardCard({
  task,
  onStatus,
}: {
  task: Task
  onStatus: (task: Task, status: TaskStatus) => void
}) {
  const { navigate } = useStore()
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id })
  return (
    <li
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={cn(
        "rounded-2xl border border-line bg-card p-2.5",
        isDragging && "relative z-10 shadow-lg"
      )}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          aria-label={`Drag ${task.title}`}
          {...attributes}
          {...listeners}
          className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => navigate({ view: "task", id: task.id })}
          className="min-w-0 flex-1 rounded-md py-1 text-left text-sm font-medium break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {task.title}
        </button>
      </div>
      <div className="mt-1 space-y-1.5 px-1">
        <DeadlineChip task={task} />
        <label className="block">
          <span className="sr-only">Status of {task.title}</span>
          <select
            value={task.status}
            onChange={(event) =>
              onStatus(task, event.target.value as TaskStatus)
            }
            className={cn(fieldClass, "h-9 text-sm")}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </li>
  )
}
