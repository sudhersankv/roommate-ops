"use client"

import { useState, useTransition } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { resetLearnedStyle } from "./learned-reset-actions"

/** "Reset what it's learned", with a confirm. The server action checks Admin again. */
export function ResetLearnedButton({ groupId, disabled = false }: { groupId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const reset = () =>
    start(async () => {
      const res = await resetLearnedStyle(groupId)
      setOpen(false)
      if (!res.ok) return void toast.add({ title: "Couldn't reset it", description: res.error, type: "error" })
      toast.add({ title: "Starting fresh", description: "Roomie starts again from new messages." })
    })

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button id="reset-learned" variant="outline" size="sm" disabled={disabled} />}>Reset what it&apos;s learned</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset what Roomie has learned here?</AlertDialogTitle>
          <AlertDialogDescription>It starts again from new messages. Nothing else changes: the ledger, the Cart and the chart stay.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={reset}>
            Reset
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
