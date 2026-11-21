import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
export function hireReport(db, now = Date.now()) {
  const cutoff = now - 7 * 86400000;
  const variants = db
    .prepare(
      "SELECT variant,count(*) visitors,count(w.visitor) writingVisitors,sum(claim) claimClicks,sum(submitted) submittingVisitors FROM visits v LEFT JOIN writers w ON w.visitor=v.id GROUP BY variant ORDER BY variant",
    )
    .all();
  const attribution = db
    .prepare(
      "SELECT v.variant,c.category,count(*) firstAuthors FROM conversions c JOIN visits v ON v.id=c.visitor GROUP BY v.variant,c.category ORDER BY v.variant,c.category",
    )
    .all();
  const rehired = db
    .prepare(
      "SELECT count(*) eligibleAuthors,coalesce(sum(EXISTS(SELECT 1 FROM entries e JOIN briefs b ON b.target=e.handle WHERE e.owner=c.owner AND e.created=c.submittedAt AND b.owner!=c.owner AND b.created>c.submittedAt AND b.created<=c.submittedAt+604800000)),0) invitedWithinSevenDays FROM conversions c WHERE c.submittedAt<=?",
    )
    .get(cutoff);
  return { variants, attribution, rehired };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const db = new DatabaseSync("deployments/private/hire/hire.sqlite", {
    readOnly: true,
  });
  try {
    console.log(JSON.stringify(hireReport(db), null, 2));
  } finally {
    db.close();
  }
}
