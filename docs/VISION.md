# Vision

## The problem

Across the Five Star family of companies (Five Star, Polytex, Starpak, Superbag, …)
there are many internal web applications and dashboards — SCADA/industrial boards,
admin panels, portals. Two pains:

1. **No single place to see health.** It's hard to know at a glance whether 20+ apps
   are up, and — crucially for industrial dashboards — whether they're actually
   *showing live data*, not just returning HTTP 200.
2. **No tracker / no ownership.** People stand up apps ("lead coding") with no central
   record, no owner, and no accountability. Shadow apps proliferate.

## What we're building

**Five Star Sentinel** — an **internal application registry + health monitor with
lightweight governance**. Three capabilities in one product:

1. **AI-visual health monitoring.** On a schedule (and on demand), open each app in a
   real browser, screenshot it, and judge **good / warning / down** — using cheap
   checks first and escalating to a **vision model** that understands whether a
   dashboard is actually rendering live data, with a per-section breakdown. This is
   the differentiated core; off-the-shelf uptime tools check "did it respond," not
   "is the data flowing."
2. **A company-scoped catalog.** Companies → categories → sites, so each company sees
   its own apps organized its own way, with per-site history.
3. **Governance.** Users submit sites, a reviewer approves them, and approved sites
   become **owned** (with a contact email) and tracked. Notifications (Teams/email)
   tell submitters when review starts and when an app is live or down.

## Who it's for

- **Everyday viewers** — plant/ops staff who just need "is my stuff up?" (must stay
  simple and non-technical).
- **Owners/contributors** — people who submit and own apps.
- **Reviewers/admins** — govern what gets registered per company.
- **Superuser** — sees everything across companies.

## Build vs buy (decision + honest caveat)

We evaluated buying instead of building. The honest breakdown:

- **Uptime + alerts + status page** is commodity — e.g. **Uptime Kuma** (free,
  self-hosted) or paid SaaS (Pingdom, Better Stack, Datadog/Checkly Synthetics).
- **Intake → review → approve → notify** is largely covered by tools most orgs
  already own — **Microsoft 365 Power Automate approvals + SharePoint**, or ITSM
  (Jira Service Management, ServiceNow).
- **AI judging whether a dashboard is genuinely showing live data (+ section
  breakdown)** is the part nothing off-the-shelf does well, and it's tuned to our
  industrial dashboards and non-technical audience.

**Decision:** build the full integrated platform (one product), accepting that we are
re-implementing some commodity pieces (alerts, approval workflow) in exchange for a
single cohesive product we control — and potentially sell. The unique moat is the AI
monitor + the tailored, company-scoped experience.

## Scope boundary (important)

Approval here is a **governance record**, not a deployment gate. This tool does not
control the deployment pipeline, so it makes shadow apps **visible, owned, and
accountable** — it does not *prevent* someone from standing an app up. Setting that
expectation avoids disappointment later.
