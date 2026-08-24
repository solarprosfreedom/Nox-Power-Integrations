import {
  buildInactiveCloserRows,
  closerRowsToCsv,
  manilaDateString,
  summarizeClosers,
} from "@/lib/inactive-closers/build-report";
import {
  fetchDeactivatedCloserPeople,
  fetchHubProjects,
  fetchInactiveSequifiUsers,
  fetchSequifiSales,
  mergeCloserPeople,
} from "@/lib/inactive-closers/fetch";
import { sendInactiveCloserReport } from "@/lib/inactive-closers/mail";

export async function runInactiveCloserReport(now = new Date()) {
  const reportDate = manilaDateString(now);
  const subject = `Inactive closer project list — ${reportDate}`;
  const [sequifiInactive, deactivated, projects, sales] = await Promise.all([
    fetchInactiveSequifiUsers(),
    fetchDeactivatedCloserPeople(),
    fetchHubProjects(),
    fetchSequifiSales(),
  ]);
  const people = mergeCloserPeople(sequifiInactive, deactivated);
  const rows = buildInactiveCloserRows({ people, projects, sales });
  const csv = closerRowsToCsv(rows);
  const mail = await sendInactiveCloserReport({ subject, reportDate, csv, rows });
  return {
    reportDate,
    subject,
    uniqueClosers: summarizeClosers(rows).length,
    projectRows: rows.length,
    sequifiInactivePeople: sequifiInactive.length,
    deactivatedCloserPeople: deactivated.length,
    hubProjects: projects.length,
    sequifiSales: sales.length,
    ...mail,
  };
}
