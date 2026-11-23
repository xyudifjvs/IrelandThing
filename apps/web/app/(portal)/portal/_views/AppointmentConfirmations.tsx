import { emailLink } from "./portal-model";
import s from "../_components/portal.module.css";

export function AppointmentConfirmations({ email }: { email?: string }) {
  const address = email && emailLink(email) ? email : "ireland@weatherlytc.com";
  return (
    <p className={s.appointmentConfirmations}>
      <strong>Appointment confirmations:</strong> Please forward any inspection,
      appraisal or walkthrough confirmations you receive to{" "}
      <a href={emailLink(address)!}>{address}</a> so I can keep everyone
      updated.
    </p>
  );
}
