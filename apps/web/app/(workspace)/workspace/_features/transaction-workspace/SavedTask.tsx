import { appointment, date, type Task } from "../../_components/data";
import { isComplete } from "../checklist/canonical-checklist-model";

export function SavedTask({ task }: { task: Task }) {
  return (
    <li>
      <strong>{task.title}</strong>
      {task.status === "not_applicable" && <span>Not needed</span>}
      {isComplete(task) && <span>Complete</span>}
      {task.dueDate && <time dateTime={task.dueDate}>{date(task.dueDate)}</time>}
      {task.note && <p>{task.note}</p>}
      {task.appointmentAt && <span>{appointment(task.appointmentAt)}</span>}
    </li>
  );
}
