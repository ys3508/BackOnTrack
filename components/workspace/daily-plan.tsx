"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, CalendarCheck, Check, Play, X } from "lucide-react"

import { Card } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { useStartFocus } from "@/components/workspace/focus-view"
import { nowIso, useStore } from "@/components/workspace/store"
import { buildDailyPlan, type NotToday } from "@/lib/planning/daily-plan"
import type { DailyPlan, DailyPlanItem, Energy } from "@/lib/workspace/schemas"
import { isActive } from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"

const TIME_OPTIONS = [15, 30, 60, 120, 180]
const ENERGY_OPTIONS: { value: Energy; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "okay", label: "Okay" },
  { value: "good", label: "Good" },
]

const chip = (on: boolean) =>
  cn(
    "min-h-11 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
    on ? "border-primary bg-sage-soft" : "border-border bg-card"
  )

function move<T>(list: T[], index: number, by: number) {
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(index + by, 0, item)
  return next
}

/** Asks one question, then proposes a plan the user can change before using it. */
export function DailyPlanner({ onClose }: { onClose?: () => void }) {
  const { state, today, dispatch } = useStore()
  const [open, setOpen] = useState(Boolean(onClose))
  const [minutes, setMinutes] = useState<number | null>(null)
  const [energy, setEnergy] = useState<Energy | null>(null)
  const [edits, setEdits] = useState<{
    items: DailyPlanItem[]
    notToday: NotToday[]
  } | null>(null)

  const proposed = useMemo(
    () =>
      minutes === null
        ? null
        : buildDailyPlan({ state, today, minutes, energy }),
    [state, today, minutes, energy]
  )

  if (!open) {
    return (
      <Button
        type="button"
        size="xl"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <CalendarCheck aria-hidden />
        Plan my day
      </Button>
    )
  }

  const items = edits?.items ?? proposed?.items ?? []
  const notToday = edits?.notToday ?? proposed?.notToday ?? []
  const total = items.reduce((sum, item) => sum + item.minutes, 0)
  const change = (next: { items: DailyPlanItem[]; notToday: NotToday[] }) =>
    setEdits(next)
  const close = () => {
    setOpen(false)
    onClose?.()
  }

  return (
    <Card className="space-y-4">
      <h2 className="font-heading text-2xl leading-snug">
        What can today realistically hold?
      </h2>

      <div role="group" aria-label="Time you have today">
        <p className="mb-1.5 text-sm font-medium">How much time do you have?</p>
        <div className="flex flex-wrap gap-1.5">
          {TIME_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={minutes === option}
              onClick={() => {
                setMinutes(option)
                setEdits(null)
              }}
              className={chip(minutes === option)}
            >
              {option < 60 ? `${option} min` : `${option / 60} hr`}
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-label="Your energy, optional">
        <p className="mb-1.5 text-sm font-medium">
          How’s your energy? <span className="font-normal">(optional)</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ENERGY_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={energy === value}
              onClick={() => {
                setEnergy(energy === value ? null : value)
                setEdits(null)
              }}
              className={chip(energy === value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {proposed && (
        <>
          <p className="text-xs text-muted-foreground">
            Calculated from your tasks, and not by AI. It plans about{" "}
            {proposed.usableMinutes} of your {minutes} minutes, leaving room for
            things that run over. Nothing changes until you use it.
          </p>

          {proposed.unfinished > 0 && (
            <p className="text-sm">
              {proposed.unfinished === 1
                ? "One task"
                : `${proposed.unfinished} tasks`}{" "}
              didn’t happen as planned earlier. This plan takes that into
              account. Nothing was marked overdue or moved.
            </p>
          )}

          {items.length > 0 ? (
            <ol aria-label="Suggested plan" className="space-y-2">
              {items.map((item, index) => (
                <li key={item.taskId} className="rounded-xl bg-secondary p-3">
                  <PlanItemText item={item} index={index} />
                  <div className="mt-1 flex flex-wrap gap-1">
                    <IconButton
                      label={`Move up: ${item.title}`}
                      disabled={index === 0}
                      onClick={() =>
                        change({ items: move(items, index, -1), notToday })
                      }
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`Move down: ${item.title}`}
                      disabled={index === items.length - 1}
                      onClick={() =>
                        change({ items: move(items, index, 1), notToday })
                      }
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </IconButton>
                    <IconButton
                      label={`Not today: ${item.title}`}
                      onClick={() =>
                        change({
                          items: items.filter((_, i) => i !== index),
                          notToday: [
                            ...notToday,
                            {
                              taskId: item.taskId,
                              title: item.title,
                              reason: "You took it off today’s plan",
                            },
                          ],
                        })
                      }
                    >
                      <X className="size-4" aria-hidden />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing on the plan. You can add something below.
            </p>
          )}

          {proposed.risks.map((risk) => (
            <p
              key={risk}
              className="rounded-lg bg-sand-soft p-3 text-sm text-sand"
            >
              {risk} Its deadline hasn’t been changed, so you may want to check
              whether there’s any flexibility.
            </p>
          ))}

          {notToday.length > 0 && (
            <div>
              <h3 className="text-sm font-medium">Not today</h3>
              <ul className="mt-1 space-y-1">
                {notToday.map((entry) => (
                  <li
                    key={entry.taskId}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 break-words">
                      {entry.title}{" "}
                      <span className="text-muted-foreground">
                        ({entry.reason})
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="lg"
                      variant="ghost"
                      aria-label={`Add to today: ${entry.title}`}
                      onClick={() => {
                        const added = buildDailyPlan({
                          state,
                          today,
                          minutes: 180,
                          energy: null,
                        }).items.find((item) => item.taskId === entry.taskId)
                        change({
                          items: [
                            ...items,
                            added ?? {
                              taskId: entry.taskId,
                              subtaskId: null,
                              title: entry.title,
                              action: `Work on “${entry.title}”`,
                              minutes: 15,
                              reason: "You added it",
                              done: false,
                            },
                          ],
                          notToday: notToday.filter(
                            (other) => other.taskId !== entry.taskId
                          ),
                        })
                      }}
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p
            className={cn(
              "text-sm font-medium",
              minutes !== null && total > minutes && "text-sand"
            )}
          >
            {total} of {minutes} minutes planned
            {minutes !== null && total > minutes
              ? ", which is more than you said you have"
              : ""}
          </p>
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xl"
          disabled={!items.length}
          onClick={() => {
            dispatch({
              type: "set-daily-plan",
              plan: {
                date: today,
                minutes: minutes ?? 0,
                energy,
                items,
                createdAt: nowIso(),
              },
            })
            close()
          }}
        >
          Use this plan
        </Button>
        <Button type="button" size="xl" variant="ghost" onClick={close}>
          Not now
        </Button>
      </div>
    </Card>
  )
}

function PlanItemText({ item, index }: { item: DailyPlanItem; index: number }) {
  return (
    <>
      <p className="text-[15px] font-medium break-words">
        {index + 1}. {item.action}
      </p>
      <p className="text-sm break-words text-muted-foreground">
        {item.action === item.title ? "" : `${item.title} · `}
        {item.minutes} min
      </p>
      <p className="mt-0.5 text-sm break-words">Why: {item.reason}.</p>
    </>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-lg outline-none hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-30"
    >
      {children}
    </button>
  )
}

/** The plan the user chose. It's a list for today, and changes no task. */
export function TodayPlan({ plan }: { plan: DailyPlan }) {
  const { state, dispatch } = useStore()
  const startFocus = useStartFocus()
  const [changing, setChanging] = useState(false)

  if (changing) return <DailyPlanner onClose={() => setChanging(false)} />

  const items = plan.items.map((item) => {
    const task = state.tasks.find((entry) => entry.id === item.taskId)
    return { ...item, finished: item.done || (task ? !isActive(task) : false) }
  })
  const allDone = items.every((item) => item.finished)

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-sans text-[15px] font-semibold tracking-normal">
          Today’s plan
        </h2>
        <span className="text-sm text-muted-foreground">
          {items.reduce((sum, item) => sum + item.minutes, 0)} minutes
        </span>
      </div>
      <ol className="space-y-2">
        {items.map((item, index) => (
          <li
            key={item.taskId}
            className={cn(
              "rounded-xl bg-secondary p-3",
              item.finished && "opacity-70"
            )}
          >
            <PlanItemText item={item} index={index} />
            <div className="mt-2 flex flex-wrap gap-2">
              {!item.finished && (
                <Button
                  type="button"
                  size="lg"
                  aria-label={`Start ${item.minutes} minutes: ${item.title}`}
                  onClick={() => startFocus(item.taskId, item.minutes)}
                >
                  <Play aria-hidden />
                  Start {item.minutes} minutes
                </Button>
              )}
              <Button
                type="button"
                size="lg"
                variant="outline"
                aria-pressed={item.done}
                aria-label={`Done for today: ${item.title}`}
                onClick={() =>
                  dispatch({ type: "toggle-daily-item", taskId: item.taskId })
                }
              >
                <Check aria-hidden />
                {item.done ? "Done for today" : "Done"}
              </Button>
              {index > 0 && (
                <IconButton
                  label={`Move up: ${item.title}`}
                  onClick={() =>
                    dispatch({
                      type: "move-daily-item",
                      taskId: item.taskId,
                      by: -1,
                    })
                  }
                >
                  <ArrowUp className="size-4" aria-hidden />
                </IconButton>
              )}
            </div>
          </li>
        ))}
      </ol>
      {allDone && (
        <p role="status" className="text-sm text-sage">
          That’s today’s plan done. Anything more is extra.
        </p>
      )}
      <Button
        type="button"
        size="lg"
        variant="ghost"
        onClick={() => setChanging(true)}
      >
        Today changed: make a new plan
      </Button>
    </Card>
  )
}
