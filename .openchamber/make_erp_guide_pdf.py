#!/usr/bin/env python3
"""Generate the College ERP - End-to-End Modules & Permissions Guide PDF."""
import os, glob

SCREENSHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots")

def img(prefix):
    matches = sorted(glob.glob(os.path.join(SCREENSHOT_DIR, prefix + "-*.jpg")))
    return matches[-1] if matches else None

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Image, Table,
                                TableStyle, PageBreak, KeepTogether, HRFlowable)
from reportlab.platypus.flowables import BalancedColumns

NAVY   = colors.HexColor("#0F2A4A")
BLUE   = colors.HexColor("#1D5FA8")
ACCENT = colors.HexColor("#E8792B")
LIGHT  = colors.HexColor("#EEF4FB")
GREY   = colors.HexColor("#5B6572")

styles = getSampleStyleSheet()

def S(name, **kw):
    base = kw.pop("parent", styles["BodyText"])
    return ParagraphStyle(name, parent=base, **kw)

sCoverTitle  = S("CoverTitle", fontName="Helvetica-Bold", fontSize=30, leading=36, textColor=colors.white, alignment=TA_CENTER)
sCoverSub    = S("CoverSub", fontName="Helvetica", fontSize=14, leading=20, textColor=colors.HexColor("#DCE6F5"), alignment=TA_CENTER)
sH1          = S("H1x", fontName="Helvetica-Bold", fontSize=19, leading=24, textColor=NAVY, spaceBefore=10, spaceAfter=6)
sH2          = S("H2x", fontName="Helvetica-Bold", fontSize=13.5, leading=17, textColor=BLUE, spaceBefore=8, spaceAfter=3)
sGroup       = S("Group", fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=colors.white, spaceBefore=6, spaceAfter=2)
sBody        = S("Body", fontSize=9.8, leading=13.8, textColor=colors.HexColor("#1B232C"))
sSmall       = S("Small", fontSize=8.6, leading=11.6, textColor=GREY)
sPerm        = S("Perm", fontSize=8.2, leading=11.2, textColor=colors.HexColor("#26507F"))
sCaption     = S("Cap", fontSize=7.8, leading=10.2, textColor=GREY, alignment=TA_CENTER)
sFoot        = S("Foot", fontSize=8, leading=10, textColor=colors.HexColor("#8A94A2"), alignment=TA_CENTER)
sMethod      = S("Method", fontSize=9.6, leading=13.4, textColor=colors.HexColor("#142130"))
sKv          = S("Kv", fontSize=9.3, leading=13, textColor=colors.HexColor("#1B232C"))

def P(text, style=sBody): return Paragraph(text, style)

def section_bar(title):
    tbl = Table([[P(title, sGroup)]], colWidths=[A4[0] - 2*49*mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), NAVY),
        ("LEFTPADDING", (0,0), (-1,-1), 12),
        ("RIGHTPADDING", (0,0), (-1,-1), 12),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
    ]))
    return tbl

def bullet(text):
    return Paragraph("&bull;&nbsp;" + text, sBody)

# ----------------------------------------------------------------- permissions
PERMS = [
"tenant.settings.manage","tenant.features.view","tenant.billing.view","billing.update",
"tenant.config.view","tenant.config.manage","users.read","users.manage",
"roles.read","roles.manage","audit.read","security.settings.view",
"security.settings.manage","security.events.view","campuses.read","campuses.manage",
"departments.read","departments.manage","programs.view","programs.manage",
"academic_years.read","academic_years.manage","terms.read","terms.manage",
"rooms.read","rooms.manage","buildings.read","buildings.manage",
"sections.read","sections.manage","batches.read","batches.manage",
"notifications.read","notifications.send","notifications.templates.manage","notifications.campaigns.manage",
"notifications.triggers.manage","notifications.config.manage","documents.read","documents.manage",
"documents.approve","students.view","students.create","students.update",
"students.delete","students.export","students.manage","academics.view",
"academics.create","academics.update","academics.delete","academics.manage",
"timetable.view","timetable.create","timetable.update","timetable.publish",
"timetable.manage","attendance.view","attendance.create","attendance.update",
"attendance.export","attendance.manage","admissions.view","admissions.create",
"admissions.update","admissions.approve","admissions.export","admissions.manage",
"fees.view","fees.create","fees.update","fees.refund",
"fees.export","fees.manage","payments.view","payments.create",
"payments.export","payments.manage","exams.view","exams.create",
"exams.update","exams.approve","exams.publish","exams.manage",
"results.view","results.publish","results.export","results.manage",
"certificates.view","certificates.create","certificates.approve","certificates.export",
"certificates.manage","library.view","library.create","library.update",
"library.delete","library.manage","hostel.view","hostel.create",
"hostel.update","hostel.delete","hostel.manage","transport.view",
"transport.create","transport.update","transport.delete","transport.manage",
"hr.view","hr.create","hr.update","hr.delete",
"hr.export","hr.manage","placements.view","placements.create",
"placements.update","placements.approve","placements.export","placements.manage",
"inventory.view","inventory.create","inventory.update","inventory.delete",
"inventory.manage","helpdesk.view","helpdesk.create","helpdesk.update",
"helpdesk.delete","helpdesk.export","helpdesk.manage","reports.view",
"reports.export","reports.manage","analytics.view","analytics.refresh",
"ai.view","ai.create","ai.update","ai.delete",
"ai.export","ai.manage","integrations.view","integrations.manage",
"identity.view","identity.manage","workflows.view","workflows.approve",
"workflows.manage","search.view","campus.settings.view","campus.settings.manage",
"campus.analytics.view","campus.policies.manage",
]

def filter_perms(prefixes_or_keys):
    out = []
    for p in PERMS:
        for rule in prefixes_or_keys:
            if rule.endswith("*"):
                if p.startswith(rule[:-1]):
                    out.append(p); break
            else:
                if p == rule:
                    out.append(p); break
    return out

def perm_block(perms):
    if not perms:
        return P("<i>No direct permission codes - access follows the role.</i>", sPerm)
    cols = 3
    cells = [f'<font color="#26507F">{p}</font>' for p in perms]
    while len(cells) % cols: cells.append("")
    rows = [cells[i:i+cols] for i in range(0, len(cells), cols)]
    t = Table([[Paragraph(c, sPerm) for c in r] for r in rows],
              colWidths=[(A4[0] - 2*49*mm) / cols]*cols)
    t.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 2),
        ("RIGHTPADDING", (0,0), (-1,-1), 2),
        ("TOPPADDING", (0,0), (-1,-1), 1),
        ("BOTTOMPADDING", (0,0), (-1,-1), 1),
    ]))
    return t

def module_flow(entry):
    flow = []
    title, sub, desc, ex, perms, shot = (entry[k] for k in
        ("title","sub","desc","ex","perms","shot"))
    flow.append(P(f'<b><font color="#0F2A4A">{title}</font></b> &nbsp;<font size="8" color="#8A94A2">/ {sub}</font>', sH2))
    flow.append(P(desc, sBody))
    flow.append(P("<b>Example / quick how-to &gt;</b> " + ex, sMethod))
    flow.append(P("<b>Permissions you have (College Admin &gt; TENANT_ADMIN):</b>", sSmall))
    flow.append(perm_block(perms))
    if shot and os.path.exists(shot):
        img_flow = Image(shot, width=3.35*inch, height=3.35*inch*598/469)
        img_flow.hAlign = "CENTER"
        cap = os.path.basename(shot)
        flow.append(Spacer(1, 4))
        flow.append(img_flow)
        flow.append(P(cap, sCaption))
    return flow

# ----------------------------------------------------------------- modules
MODULES = [
 dict(group="ACADEMICS",
   entries=[
    dict(title="Students", sub="students", img="mod-03",
      desc="Central register of all enrolled students - profiles, contact details, guardian info, admission data, documents and status.",
      ex="Open <b>Students</b>, use the search box to find a student (e.g. by name or roll no.), open a profile to see their documents, and use <b>Export</b> to download the list as CSV.",
      perms=filter_perms(["students.*"])),
    dict(title="Admissions", sub="admissions", img="mod-04",
      desc="Manage the full admission lifecycle: enquiries, applications, eligibility rules, offers, documents and fee payment against admissions.",
      ex="Review pending applications, check eligibility, approve an application, and send an admission offer to the applicant's guardian.",
      perms=filter_perms(["admissions.*"])),
    dict(title="Academics", sub="academics", img="mod-05",
      desc="Academic structure and delivery: programmes, courses/curricula, programmes offered, and academic records.",
      ex="Create a programme, add its courses, and track curriculum progress for each term and batch.",
      perms=filter_perms(["academics.*","programs.*","academic_years.*","terms.*","sections.*","batches.*","departments.*"])),
    dict(title="Timetable", sub="timetable", img="mod-06",
      desc="Build, publish and view class timetables; structure timetable periods and operations per room, block and batch.",
      ex="Generate a timetable for a batch, resolve clashes, then <b>Publish</b> so students and faculty can view it.",
      perms=filter_perms(["timetable.*","rooms.*","buildings.*"])),
    dict(title="Attendance", sub="attendance", img="mod-07",
      desc="Record and review daily attendance per class/batch, with export and reporting.",
      ex="Mark attendance for today's class, review the attendance percentage per student, and export the register.",
      perms=filter_perms(["attendance.*"])),
    dict(title="Examinations", sub="exams", img="mod-08",
      desc="Exam setup, schedules, approvals and publishing; plus results sessions, publishing and exports.",
      ex="Create an exam, schedule it for a batch, approve, then publish results once marks are final.",
      perms=filter_perms(["exams.*","results.*"])),
    dict(title="Certificates", sub="certificates", img="mod-09",
      desc="Create, approve, issue and verify certificates (bonafide, leaving, character, etc.).",
      ex="Create a certificate for a student, route it for approval, then issue it - the public <b>/verify/certificate</b> page checks authenticity.",
      perms=filter_perms(["certificates.*"])),
   ]),
 dict(group="CAMPUS & SERVICES",
   entries=[
    dict(title="Library", sub="library", img="mod-10",
      desc="Catalogue books, manage members and track lending within the library.",
      ex="Add a book to the catalogue, issue it to a student member, and record the return.",
      perms=filter_perms(["library.*"])),
    dict(title="Inventory", sub="inventory", img="mod-11",
      desc="Track assets and consumables across the campus - stock levels, issuances and usage.",
      ex="Record an asset, log a stock issue to a department, and check current stock levels.",
      perms=filter_perms(["inventory.*"])),
    dict(title="Hostel", sub="hostel", img="mod-12",
      desc="Hostel blocks, rooms and allocations, plus fee/invoice management for hostellers.",
      ex="Allocate a room to a student, track block occupancy, and generate the hostel fee invoice.",
      perms=filter_perms(["hostel.*","fees.*","payments.*"])),
    dict(title="Transport", sub="transport", img="mod-13",
      desc="Routes, vehicles and stops; manage student assignments and transport fees.",
      ex="Define a route with stops, assign vehicle capacity, and attach students to routes.",
      perms=filter_perms(["transport.*","fees.*"])),
    dict(title="HR & Faculty", sub="hr", img="mod-14",
      desc="Staff & faculty records, departments, leave, workload and payroll-oriented data.",
      ex="Add a faculty member to a department, record their leave, and export the staff list.",
      perms=filter_perms(["hr.*"])),
    dict(title="Placements", sub="placements", img="mod-15",
      desc="Placement drives, companies, applications and placements; approvals and exports.",
      ex="Open a placement drive, add companies, shortlist applicants and approve placements.",
      perms=filter_perms(["placements.*"])),
    dict(title="Helpdesk", sub="helpdesk", img="mod-16",
      desc="Ticket-based support for students and staff - raise, assign, resolve and export tickets.",
      ex="Assign an open ticket to a department, add updates, and mark it resolved.",
      perms=filter_perms(["helpdesk.*"])),
   ]),
 dict(group="OPERATIONS",
   entries=[
    dict(title="Notifications", sub="notifications", img="mod-17",
      desc="Send and schedule notifications, manage templates, campaigns and triggers.",
      ex="Create a notification template, launch a campaign to a student group, and review delivery.",
      perms=filter_perms(["notifications.*"])),
    dict(title="Documents", sub="documents", img="mod-18",
      desc="Central document store per tenant - upload, organise, approve and control access.",
      ex="Upload a policy document, set visibility, and route it through approval.",
      perms=filter_perms(["documents.*","workflows.*"])),
    dict(title="Integrations", sub="integrations", img="mod-19",
      desc="Connect external services (SMS, email, payments, ERP tools) via a generic framework.",
      ex="Enable an SMS provider integration and test the connection from the integration list.",
      perms=filter_perms(["integrations.*"])),
    dict(title="Single sign-on", sub="identity", img="mod-20",
      desc="Configure SSO providers (Google, Microsoft, SAML/OIDC) so users sign in once.",
      ex="Add an OIDC provider, copy the callbacks, and set it as the tenant's default sign-in method.",
      perms=filter_perms(["identity.*"])),
    dict(title="Reports", sub="reports", img="mod-21",
      desc="Prebuilt institutional reports across modules with export to file.",
      ex="Open the Reports centre and export the attendance or fee-collection report for the current term.",
      perms=filter_perms(["reports.*","attendance.export","fees.export","payments.export","students.export","admissions.export","results.export","certificates.export","hr.export","placements.export","helpdesk.export","ai.export"])),
    dict(title="Import / Export", sub="imports", img="mod-22",
      desc="Bulk data operations - import students/records from CSV and export data from any module.",
      ex="Download the CSV template, fill it, upload it, and review the import summary for errors.",
      perms=filter_perms(["students.export","attendance.export","admissions.export","fees.export","payments.export","results.export","certificates.export","hr.export","placements.export","helpdesk.export","reports.export","ai.export"])),
    dict(title="Analytics", sub="analytics", img="mod-23",
      desc="Dashboards and insights across academics, attendance, finance and campus operations.",
      ex="Open Analytics and click <b>Refresh</b> to rebuild the KPI dashboard from live data.",
      perms=filter_perms(["analytics.*","campus.analytics.view"])),
    dict(title="AI Assistant", sub="ai-assistant", img="mod-24",
      desc="An in-app AI assistant to answer questions about students, academics and operations.",
      ex="Ask the assistant for a quick summary of this term's attendance outliers.",
      perms=filter_perms(["ai.*","search.view"])),
   ]),
 dict(group="ORGANIZATION",
   entries=[
    dict(title="Organization", sub="organization", img="mod-25",
      desc="Org-level setup: departments, programmes, academic years, terms, buildings, rooms, sections, batches and users/roles.",
      ex="Add a department, define the current academic year + term, then create programs under them.",
      perms=filter_perms(["departments.*","programs.*","academic_years.*","terms.*","buildings.*","rooms.*","sections.*","batches.*","users.*","roles.*"])),
    dict(title="Campuses", sub="campuses", img="mod-26",
      desc="Manage one or more campuses, their locations, settings and policies.",
      ex="Create a second campus, review its settings, and manage campus policies.",
      perms=filter_perms(["campuses.*","campus.settings.*","campus.policies.*"])),
   ]),
 dict(group="ADMINISTRATION",
   entries=[
    dict(title="Audit log", sub="audit", img="mod-27",
      desc="Full trace of who did what inside the tenant - logins, changes, admin actions.",
      ex="Search the audit trail by user or action to audit a recent change.",
      perms=filter_perms(["audit.read","security.events.view","security.settings.*"])),
    dict(title="Billing", sub="billing", img="mod-28",
      desc="Subscription and billing for the tenant - plan, invoices and payment status.",
      ex="Review current plan usage and view latest invoices from the billing dashboard.",
      perms=filter_perms(["tenant.billing.view","billing.update","fees.*","payments.*"])),
    dict(title="Configuration", sub="settings", img="mod-29",
      desc="Tenant-wide configuration: branding, settings, feature flags and security settings.",
      ex="Flip a feature flag on, update branding, and review security settings from one screen.",
      perms=filter_perms(["tenant.settings.*","tenant.features.*","tenant.config.*","security.settings.*","workflows.*"])),
   ]),
]

# ----------------------------------------------------------------- document
OUT = "College-ERP-End-to-End-Guide.pdf"
OUT_PATH = os.path.join(os.getcwd(), OUT)

M = 49*mm
AW = A4[0] - 2*M

def onPage(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(colors.HexColor("#EDF2F9"))
    canvas.rect(0, A4[1]-14*mm, A4[0], 14*mm, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(M, A4[1]-9*mm, "College ERP - End-to-End Modules & Permissions Guide")
    canvas.setFillColor(GREY)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(A4[0]-M, A4[1]-9*mm, "Professional-SaaS")
    # footer
    canvas.setStrokeColor(colors.HexColor("#D4DCE6"))
    canvas.setLineWidth(0.5)
    canvas.line(M, 14*mm, A4[0]-M, 14*mm)
    canvas.setFillColor(GREY)
    canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(A4[0]/2, 9*mm, f"Page {doc.page}")
    canvas.restoreState()

doc = SimpleDocTemplate(OUT_PATH, pagesize=A4,
                        leftMargin=M, rightMargin=M, topMargin=20*mm, bottomMargin=20*mm,
                        title="College ERP - End-to-End Modules & Permissions Guide",
                        author="Professional-SaaS local setup",
                        subject="All modules, permissions and usage walkthrough from login to logout")

story = []

# ---- cover
cover_img = img("mod-01")
cw = AW
ch = cw*598/469
if ch > A4[1]*0.55: 
    ch = A4[1]*0.55
    cw = ch*469/598
story.append(Spacer(1, 18*mm))
cover_tbl = Table([[Paragraph("COLLEGE ERP", sCoverTitle)],
                   [Paragraph("Modules & Permissions Guide", S("cs2", parent=sCoverSub, fontSize=16, leading=22))],
                   [Paragraph("A complete end-to-end walkthrough - from <b>login</b> to <b>logout</b> - covering every module, what each one does, screenshots, examples, and the permission model.", sCoverSub)]],
                  colWidths=[AW])
cover_tbl.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), NAVY),
    ("TOPPADDING", (0,0), (-1,0), 26),
    ("BOTTOMPADDING", (0,-1), (-1,-1), 30),
    ("TOPPADDING", (0,2), (-1,2), 6),
    ("LEFTPADDING", (0,0), (-1,-1), 26),
    ("RIGHTPADDING", (0,0), (-1,-1), 26),
]))
story.append(cover_tbl)
story.append(Spacer(1, 10*mm))
if cover_img and os.path.exists(cover_img):
    i2 = Image(cover_img, width=4.4*inch, height=4.4*inch*598/469)
    i2.hAlign = "CENTER"
    story.append(i2)
    story.append(P("Figure 1 - Tenant login screen", sCaption))
story.append(Spacer(1, 6*mm))
info = Table([[P("<b>Prepared for:</b> Parth (slug: <b>parth</b>)", sMethod), P("<b>Date:</b> 11 October 2026", sMethod)],
              [P("<b>App URL:</b> http://localhost:5173", sMethod), P("<b>API URL:</b> http://localhost:3000", sMethod)],
              [P("<b>Emails:</b> parth@gmail.com  &bull;  admin@sunrise-demo.edu", sMethod), P("<b>Support:</b> this repository", sMethod)]],
             colWidths=[AW/2, AW/2])
info.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), LIGHT),
    ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#D4DCE6")),
    ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ("LEFTPADDING", (0,0), (-1,-1), 10),
]))
story.append(info)
story.append(PageBreak())

# ---- 1. Getting started / login
story.append(section_bar("1  Getting started - how you sign in"))
story.append(Spacer(1, 6))
story.append(P("The system has two login realms, and the concepts to remember are <b>Tenant slug</b>, <b>Email</b> and <b>Password</b>.", sBody))
steps = [
 "Open the app at <b>http://localhost:5173</b>. A sign-in form appears (Figure 1).",
 "Type the <b>tenant slug</b> - each college is its own tenant. Yours is <b>parth</b> (the demo college is <b>demo-college</b>).",
 "Type your email - <b>parth@gmail.com</b> - and the password (<b>ChangeMe123!</b> on this local setup).",
 "Press <b>Sign in</b>. You land on the Dashboard. From here every module is one click away in the left sidebar.",
]
for i, s in enumerate(steps, 1):
    story.append(bullet(f"<b>Step {i}.</b> {s}"))
story.append(Spacer(1, 5))
story.append(P("<b>If you see 'You do not have access to this tenant.'</b> - that usually means the browser still holds a token from a different tenant (slug). Fix: sign out, then sign in again with the right slug (<b>parth</b>).", sMethod))
creds = Table([["Tenant", "Email", "Password", "Role"],
               ["parth", "parth@gmail.com", "ChangeMe123!", "College Admin"],
               ["demo-college", "admin@sunrise-demo.edu", "ChangeMe123!", "College Admin"],
               ["platform", "platform-admin@college-erp.local", "ChangeMe123!", "Platform Administrator"]],
              colWidths=[AW*0.16, AW*0.42, AW*0.24, AW*0.18])
creds.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), NAVY),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 8.5),
    ("GRID", (0,0), (-1,-1), 0.4, colors.HexColor("#C9D4E2")),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, LIGHT]),
    ("TOPPADDING", (0,0), (-1,-1), 4), ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ("LEFTPADDING", (0,0), (-1,-1), 6),
]))
story.append(P("<b>Accounts available in this database</b>", sH2))
story.append(creds)
story.append(Spacer(1, 6))

login_img = img("mod-01")
dash_img = img("mod-02")
side_by = Table([[Image(login_img, width=(AW-6)/2, height=(AW-6)/2*598/469),
                  Image(dash_img, width=(AW-6)/2, height=(AW-6)/2*598/469)]],
                colWidths=[(AW-6)/2, (AW-6)/2])
side_by.setStyle(TableStyle([("ALIGN",(0,0),(-1,-1),"CENTER"),
                             ("VALIGN",(0,0),(-1,-1),"TOP"),
                             ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),6)]))
story.append(side_by)
story.append(P("Figure 2 - Login screen (left) and the Dashboard you land on after signing in (right)", sCaption))
story.append(PageBreak())

# ---- 2. Dashboard
story.append(section_bar("2  The Dashboard - your command centre"))
story.append(Spacer(1, 6))
stats = [("28","AVAILABLE MODULES"),("154","EFFECTIVE PERMISSIONS"),
         ("22","ENABLED FEATURE FLAGS"),("11","ACTIVE ENTITLEMENTS")]
cells = [[Paragraph(f'<font size="22" color="#0F2A4A"><b>{n}</b></font><br/><font size="8" color="#5B6572">{l}</font>', sKv) for n,l in stats]]
sq = Table(cells, colWidths=[AW/4]*4, rowHeights=[28])
sq.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,-1),LIGHT),
    ("BOX",(0,0),(-1,-1),0.6,colors.HexColor("#C9D4E2")),
    ("INNERGRID",(0,0),(-1,-1),0.4,colors.HexColor("#C9D4E2")),
    ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("ALIGN",(0,0),(-1,-1),"CENTER"),
]))
story.append(sq)
story.append(Spacer(1, 6))
story.append(P("The dashboard is your home screen. It shows four headline numbers (above), a <b>Your modules</b> grid, and the global search (<b>Ctrl + K</b>). The number <b>154 effective permissions</b> answers the question <i>\"what access do I have?\"</i> - as College Admin (<b>TENANT_ADMIN</b> role) you hold every permission in this tenant. Other roles (Principal, Registrar, Accountant, Faculty, Student, Parent...) see only the modules their role allows.", sBody))
if dash_img:
    d2 = Image(dash_img, width=4.6*inch, height=4.6*inch*598/469)
    d2.hAlign = "CENTER"
    story.append(d2)
    story.append(P("Figure 3 - Dashboard with module grid and permission summary", sCaption))
story.append(Spacer(1, 6))
story.append(P("<b>Module navigation</b> - the sidebar is organised into 5 groups:", sBody))
groups = ["<b>ACADEMICS</b> - Students, Admissions, Academics, Timetable, Attendance, Examinations, Certificates",
          "<b>CAMPUS &amp; SERVICES</b> - Library, Inventory, Hostel, Transport, HR &amp; Faculty, Placements, Helpdesk",
          "<b>OPERATIONS</b> - Notifications, Documents, Integrations, Single sign-on, Reports, Import / Export, Analytics, AI Assistant",
          "<b>ORGANIZATION</b> - Organization, Campuses",
          "<b>ADMINISTRATION</b> - Audit log, Billing, Configuration"]
for g in groups:
    story.append(bullet(g))
story.append(bullet("<b>Sign out</b> - at the bottom of the sidebar, or from the account menu."))
story.append(PageBreak())

# ---- 3. Modules
story.append(section_bar("3  All 28 modules - what each one does, with examples and permissions"))
story.append(Spacer(1, 6))
story.append(P("Each module below is shown with a live screenshot from this database, a short description, an example of how you would use it, and the precise <b>permission codes</b> the College Admin role grants for it. A module acts as the <i>example</i> for how your tenant works - you can click straight into it from the sidebar.", sBody))
story.append(Spacer(1, 4))

for group in MODULES:
    story.append(KeepTogether(Table([[Paragraph(group["group"], sGroup)]], colWidths=[AW])))
    story.append(Spacer(1, 4))
    for entry in group["entries"]:
        entry["shot"] = img(entry["img"]) or ""
        story.extend(module_flow(entry))
        story.append(Spacer(1, 8))
        story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#D4DCE6")))
        story.append(Spacer(1, 4))
    story.append(PageBreak())

# ---- 4. Permission catalog
story.append(section_bar("4  The permission catalog - all 154 permission codes"))
story.append(Spacer(1, 6))
story.append(P("This is every permission code defined in the system, grouped by module area. The <b>TENANT_ADMIN</b> (College Admin) role receives all of them; other roles receive a subset. These codes are enforced by the API on every request, and the UI hides anything you cannot do.", sBody))
story.append(Spacer(1, 4))

def smart_group(key, items):
    return P(f'<b><font color="#1D5FA8">{key}</font></b>', sH2)

groups_catalog = [
 ("Tenant / billing", ["tenant.settings.manage","tenant.features.view","tenant.billing.view","tenant.config.view","tenant.config.manage","billing.update"]),
 ("Users & roles", ["users.read","users.manage","roles.read","roles.manage"]),
 ("Audit & security", ["audit.read","security.settings.view","security.settings.manage","security.events.view"]),
 ("Campus & structure", ["campuses.read","campuses.manage","departments.read","departments.manage","programs.view","programs.manage","academic_years.read","academic_years.manage","terms.read","terms.manage","rooms.read","rooms.manage","buildings.read","buildings.manage","sections.read","sections.manage","batches.read","batches.manage","campus.settings.view","campus.settings.manage","campus.analytics.view","campus.policies.manage"]),
 ("Notifications", ["notifications.read","notifications.send","notifications.templates.manage","notifications.campaigns.manage","notifications.triggers.manage","notifications.config.manage"]),
 ("Documents & workflows", ["documents.read","documents.manage","documents.approve","workflows.view","workflows.approve","workflows.manage","search.view"]),
 ("Students", ["students.view","students.create","students.update","students.delete","students.export","students.manage"]),
 ("Academics", ["academics.view","academics.create","academics.update","academics.delete","academics.manage"]),
 ("Timetable", ["timetable.view","timetable.create","timetable.update","timetable.publish","timetable.manage"]),
 ("Attendance", ["attendance.view","attendance.create","attendance.update","attendance.export","attendance.manage"]),
 ("Admissions", ["admissions.view","admissions.create","admissions.update","admissions.approve","admissions.export","admissions.manage"]),
 ("Fees & payments", ["fees.view","fees.create","fees.update","fees.refund","fees.export","fees.manage","payments.view","payments.create","payments.export","payments.manage"]),
 ("Examinations & results", ["exams.view","exams.create","exams.update","exams.approve","exams.publish","exams.manage","results.view","results.publish","results.export","results.manage"]),
 ("Certificates", ["certificates.view","certificates.create","certificates.approve","certificates.export","certificates.manage"]),
 ("Library", ["library.view","library.create","library.update","library.delete","library.manage"]),
 ("Inventory", ["inventory.view","inventory.create","inventory.update","inventory.delete","inventory.manage"]),
 ("Hostel", ["hostel.view","hostel.create","hostel.update","hostel.delete","hostel.manage"]),
 ("Transport", ["transport.view","transport.create","transport.update","transport.delete","transport.manage"]),
 ("HR & faculty", ["hr.view","hr.create","hr.update","hr.delete","hr.export","hr.manage"]),
 ("Placements", ["placements.view","placements.create","placements.update","placements.approve","placements.export","placements.manage"]),
 ("Helpdesk", ["helpdesk.view","helpdesk.create","helpdesk.update","helpdesk.delete","helpdesk.export","helpdesk.manage"]),
 ("Reports", ["reports.view","reports.export","reports.manage"]),
 ("Analytics", ["analytics.view","analytics.refresh"]),
 ("AI Assistant", ["ai.view","ai.create","ai.update","ai.delete","ai.export","ai.manage"]),
 ("Integrations", ["integrations.view","integrations.manage"]),
 ("Identity / SSO", ["identity.view","identity.manage"]),
]
for key, keys in groups_catalog:
    story.append(smart_group(key, [k for k in keys if k in PERMS]))
    story.append(perm_block([k for k in keys if k in PERMS]))
    story.append(Spacer(1, 3))
story.append(PageBreak())

# ---- 5. Platform console
story.append(section_bar("5  The platform (SaaS control plane) - manage all tenants"))
story.append(Spacer(1, 6))
story.append(P("The <b>Platform Admin</b> is a separate application at <b>/platform/login</b> that operates across all tenants. You use it to create colleges (tenants), watch system health, review billing, and inspect the global audit trail.", sBody))
steps2 = [
 "Go to <b>http://localhost:5173/platform/login</b> and sign in with <b>platform-admin@college-erp.local</b> / <b>ChangeMe123!</b>.",
 "The dashboard shows all tenants, active users, storage, support tickets, and <b>System health</b> (Database: ok, Redis: ok).",
 "Open <b>Tenants</b> to see every college - including your new tenant <b>parth</b>.",
]
for i, s in enumerate(steps2, 1):
    story.append(bullet(f"<b>Step {i}.</b> {s}"))
story.append(Spacer(1, 5))
plat_login = img("plat-01")
plat_dash = img("plat-02")
side2 = Table([[Image(plat_login, width=(AW-6)/2, height=(AW-6)/2*598/469),
                Image(plat_dash, width=(AW-6)/2, height=(AW-6)/2*598/469)]],
              colWidths=[(AW-6)/2, (AW-6)/2])
side2.setStyle(TableStyle([("ALIGN",(0,0),(-1,-1),"CENTER"),("VALIGN",(0,0),(-1,-1),"TOP"),
                           ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),6)]))
story.append(side2)
story.append(P("Figure 4 - Platform login &amp; control-plane dashboard (health: Database ok, Redis ok)", sCaption))
story.append(Spacer(1, 6))

tinfo = Table([["Tenant","Slug","Status","Data"],
               ["Sunrise Institute of Technology & Management","demo-college","ACTIVE","46 students, seeded demo"],
               ["parth (Parth's college)","parth","ACTIVE","1 admin user, empty - ready to set up"]],
              colWidths=[AW*0.5, AW*0.16, AW*0.12, AW*0.22])
tinfo.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,0),NAVY),("TEXTCOLOR",(0,0),(-1,0),colors.white),
    ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,-1),8.4),
    ("GRID",(0,0),(-1,-1),0.4,colors.HexColor("#C9D4E2")),
    ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,LIGHT]),
    ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ("LEFTPADDING",(0,0),(-1,-1),6),
]))
story.append(P("<b>Tenants in this database (from the platform console)</b>", sH2))
story.append(tinfo)
story.append(PageBreak())

# ---- 6. Your new tenant
story.append(section_bar("6  Your tenant: slug 'parth'"))
story.append(Spacer(1, 6))
story.append(P("Your college already exists in the database as tenant slug <b>parth</b> (status ACTIVE), with you as its first <b>College Admin</b> user: <b>parth@gmail.com</b>. The password was reset to the local dev password <b>ChangeMe123!</b> so you can sign straight in. The tenant is intentionally fresh - a clean database with zero students - so everything you add is yours alone.", sBody))
story.append(Spacer(1, 3))
story.append(P("<b>What the database currently holds for 'parth':</b>", sH2))
rows = [["Item","Count","Notes"],
        ["Tenant", "1", "slug = parth, name = parth, ACTIVE"],
        ["Admin user", "1", "parth@gmail.com - Parth Prajapati - College Admin"],
        ["Roles", "15", "College Admin / Principal / Registrar / Accountant / Faculty / Student / Parent, etc."],
        ["Students", "0", "you create them in Students"],
        ["Campuses", "0", "add one under Campuses"],
        ["Subscriptions", "3", "active plan rows for the tenant"],
]
tb = Table(rows, colWidths=[AW*0.2, AW*0.1, AW*0.7])
tb.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,0),BLUE),("TEXTCOLOR",(0,0),(-1,0),colors.white),
    ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,-1),8.6),
    ("GRID",(0,0),(-1,-1),0.4,colors.HexColor("#C9D4E2")),
    ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,LIGHT]),
    ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ("LEFTPADDING",(0,0),(-1,-1),6),
]))
story.append(tb)
story.append(Spacer(1, 6))
story.append(P("<b>Suggested 15-minute setup order for 'parth':</b>", sH2))
setup = [
 "<b>Configuration</b> - give the college its name, branding and feature flags.",
 "<b>Organization</b> - add departments and the current academic year + terms.",
 "<b>Academics</b> - create programmes with their courses.",
 "<b>Campuses</b> - create your campus (location + settings).",
 "<b>Users</b> - add staff (Principal, Registrar, Faculty) so records can be distributed.",
 "<b>Students / Admissions</b> - start adding student records or import a CSV.",
]
for s in setup:
    story.append(bullet(s))
story.append(PageBreak())

# ---- 7. End-to-end day, logout, portals
story.append(section_bar("7  End-to-end flow - a typical day, then logout"))
story.append(Spacer(1, 6))
story.append(P("This is the complete login-to-logout journey through the product using your own tenant:", sBody))
travel = ["<b>Login</b>: localhost:5173 &rarr; slug <b>parth</b> &rarr; parth@gmail.com &rarr; dashboard",
 "<b>Dashboard</b>: check the 28 modules, 154 permissions, system highlights.",
 "<b>Academics</b>: open Organization / Academics, define programmes &amp; terms.",
 "<b>Admissions</b>: register an enquiry &rarr; approve &rarr; offer.",
 "<b>Students</b>: create the student record and upload documents.",
 "<b>Timetable &amp; Attendance</b>: publish the timetable, then mark daily attendance.",
 "<b>Examinations</b>: schedule the exam &rarr; enter results &rarr; publish.",
 "<b>Certificates</b>: issue a certificate; anyone can verify it via /verify/certificate.",
 "<b>Campus services</b>: use Library, Hostel, Transport, Inventory, HR, Placements, Helpdesk.",
 "<b>Operations</b>: send Notifications, keep Documents in one place, connect Integrations, enable SSO, review Reports, Import/Export, Analytics and the AI Assistant.",
 "<b>Administration</b>: watch the Audit log, keep Billing current, tune Configuration.",
 "<b>Platform</b> (admin): check system health, tenants and global audit at /platform/login.",
 "<b>Logout</b>: click <b>Sign out</b> in the sidebar (tenant) or <b>Log out</b> (platform) to end the session securely."]
for t in travel:
    story.append(bullet(t))
story.append(Spacer(1, 8))
story.append(section_bar("  Other entrances (portals used by students / parents / faculty)"))
story.append(Spacer(1, 5))
story.append(P("Alongside the administration app there are separate portals for other audiences:", sBody))
portals = ["<b>/portal</b> - Student portal: dashboard, ID card, profile, attendance, timetable, courses, fees &amp; payments, exams, results, certificates, library, hostel, transport, notices, tickets, documents.",
 "<b>/parent</b> - Parent portal: dashboard, attendance, timetable, fees &amp; payments, exams, results, notices, documents, transport, hostel.",
 "<b>/faculty</b> - Faculty portal: dashboard, profile, courses, students, timetable, attendance, marks, academics, leave, workload, notifications, reports.",
 "<b>/verify/certificate</b> and <b>/verify/student-id</b> - public verification pages for issued certificates and student ID cards.",
 "<b>/platform</b> - Platform (SaaS) admin console."]
for p in portals:
    story.append(bullet(p))
story.append(Spacer(1, 8))
story.append(HRFlowable(width="100%", thickness=0.6, color=ACCENT))
story.append(P("Key takeaway &mdash; log in with your tenant slug once, browse the 28 modules in the sidebar, and the UI only shows what your role allows. Every action you take is recorded in the Audit log, and Sign out ends the session. The whole journey from login to logout is what this guide has walked you through.", sMethod))

doc.build(story, onFirstPage=onPage, onLaterPages=onPage)
print("WROTE", OUT_PATH)