import { redirect } from "next/navigation"

export default function OldTasksPage() {
  redirect("/dashboard/reminders")
}
