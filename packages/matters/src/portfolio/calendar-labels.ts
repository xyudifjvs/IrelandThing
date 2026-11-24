import { clientStepKey } from "../projections/client-timeline-layout";

export function calendarStepKey(task: {
  title: string;
  stepKey?: string | null;
}) {
  return clientStepKey(task);
}

export function appointmentCalendarLabel(task: {
  title: string;
  stepKey?: string | null;
}) {
  switch (calendarStepKey(task)) {
    case "appraisal_ordered":
      return "Appraisal appointment";
    case "inspections":
      return "Inspection appointment";
    case "final_walkthrough":
      return "Final walkthrough";
    case "closing":
      return "Closing appointment";
    default:
      return `${task.title} appointment`;
  }
}
