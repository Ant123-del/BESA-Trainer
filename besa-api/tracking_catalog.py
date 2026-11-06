#what gets measured at clock-out. A project is a set of "measures" - each one a typed way of finding out what got
#done - so a new project is only data: Manage Projects writes the same shape to Firestore that DEFAULT_PROJECTS seeds.
#A project's `activities` are the kiosk activity names that count as working on it (a project made on Manage Projects
#gets one named after itself), so the Tours/Meeting/Event kind of activity simply has no project and nothing to measure.

#type -> where the data comes from: "self" is typed in at clock-out, "upload" is a screenshot sent from their own
#device, "auto" is fetched at clock-out for the time they were clocked in
MEASURE_TYPES = {
    "quantity": "self",
    "checkbox": "self",
    "screenshot": "upload",
    "github": "auto",
    "google_sheets": "auto",
    "google_slides": "auto",
    "gmail": "auto",
    "google_calendar": "auto",
    "booking_db": "auto",
    "trainer_data": "auto",
    "trainer_practice": "auto",
    "course": "auto",
    "custom_api": "auto",
}

DESIGN_LOOK_FOR = (
    "CAD work (Fusion 360 and similar). Compare the design history / timeline at the bottom of the window first, then the "
    "model itself. Design is slow and a lot of it is thinking, redoing and test fitting, so give this the most slack of "
    "anything: a few new timeline steps in a shift is good progress."
)

DEFAULT_PROJECTS = [
    {
        "id": "outreach-demo",
        "name": "Outreach Demo",
        "activities": ["Demo and Presentation for Outreach"],
        "description": "Building the outreach demo: 3D printing, stickers, laser cutting, design and web dev.",
        "measures": [
            {"id": "prints", "type": "quantity", "label": "3D prints", "unit": "printed"},
            {"id": "laser", "type": "quantity", "label": "Laser cut pieces", "unit": "cut"},
            {"id": "stickers", "type": "quantity", "label": "Stickers", "unit": "made"},
            {"id": "design", "type": "screenshot", "label": "Design (Fusion 360, etc.)", "lookFor": DESIGN_LOOK_FOR},
            {"id": "webdev", "type": "github", "label": "Web dev", "repos": []},
        ],
    },
    {
        "id": "outreach-slides",
        "name": "Outreach Slides",
        "activities": ["Outreach Slides"],
        "description": "Editing the outreach slide decks.",
        "measures": [
            {"id": "deck", "type": "google_slides", "label": "Slide decks", "fileIds": []},
            #the Slides API doesn't expose animations at all, so these can only be reported
            {"id": "animations", "type": "quantity", "label": "Animations added", "unit": "added"},
        ],
    },
    {
        "id": "employee-data",
        "name": "Employee Data",
        "activities": ["Employment Data"],
        "description": "Entering employee data into Google Sheets.",
        "measures": [
            {"id": "sheets", "type": "google_sheets", "label": "Employee sheets", "fileIds": []},
        ],
    },
    {
        "id": "lead-email",
        "name": "Lead Email Management",
        "activities": ["BESA Lead Email Management"],
        "description": "Answering the ucscbesa@ucsc.edu inbox and managing the calendars.",
        "measures": [
            {"id": "sent", "type": "gmail", "label": "Emails sent"},
            {"id": "calendar", "type": "google_calendar", "label": "Calendar changes"},
        ],
    },
    {
        "id": "besa-trainer",
        "name": "BESA Trainer",
        "activities": ["BESA Trainer input data", "Script Rehearsal"],
        "description": "Working on or practicing in BESA Trainer.",
        "measures": [
            {"id": "changes", "type": "github", "label": "Code changes", "repos": ["Ant123-del/BESA-Trainer"]},
            {"id": "data", "type": "trainer_data", "label": "Data input"},
            {"id": "practice", "type": "trainer_practice", "label": "Practice checkpoints"},
        ],
    },
    {
        "id": "besa-booking",
        "name": "BESA Booking",
        "activities": ["BESA Booking"],
        "description": "Web fixes, booking adjustments, setting up tours and adjusting office hours.",
        "measures": [
            {"id": "web", "type": "github", "label": "Web fixes",
             "repos": ["BE-Student-Ambassadors/BESABooking", "BE-Student-Ambassadors/besabookingapi"]},
            {"id": "database", "type": "booking_db", "label": "Booking database changes"},
        ],
    },
    {
        "id": "besa-challenge",
        "name": "BESA Challenge",
        "activities": ["BESA Challenge"],
        "description": "Work on besachallenge.vercel.app.",
        "measures": [
            {"id": "site", "type": "github", "label": "Site changes", "repos": []},
        ],
    },
    {
        "id": "slugworks-course",
        "name": "Slugworks Course",
        "activities": ["slugworks canvas course"],
        "description": "Getting certified on the Slugworks machines.",
        "measures": [
            {"id": "course", "type": "course", "label": "Course items finished"},
        ],
    },
    {
        "id": "other",
        "name": "Other",
        "activities": ["Other"],
        "description": "Anything else. Say what it was in the description.",
        "measures": [
            {"id": "progress", "type": "screenshot", "label": "Progress screenshot",
             "lookFor": "Could be anything, so go by their description of what they worked on."},
        ],
    },
]


def _page(title, indent=0, required=True):
    return {"title": title, "kind": "page", "indent": indent, "required": required}


def _quiz(title, points, indent=0):
    return {"title": title, "kind": "quiz", "points": points, "indent": indent, "required": True}


def _task(title, points, indent=0):
    return {"title": title, "kind": "assignment", "points": points, "indent": indent, "required": True}


#copied from the Slugworks Canvas modules page. Modules that were collapsed on that page aren't here. Items Canvas gives
#no completion circle to (required False) are listed the same way but can't be ticked and don't count toward certifying.
SLUGWORKS_COURSE = {
    "id": "slugworks",
    "title": "Slugworks",
    "modules": [
        {"id": "welcome", "title": "Welcome to Slugworks", "prerequisites": [], "items": [
            _page("Who We Are & What We Stand For"),
            _page("Meet The Slugworks Staff", 1, required=False),
            _page("Spaces Explained"),
            _page("Location of Slugworks Spaces", 1),
            _page("How to Navigate the Slugworks Canvas"),
            _page("Machine Modules Explained", 1),
            _page("Slugworks x DSI 3D Printing Collaboration"),
            _page("Frequently Asked Questions"),
            _page("Glossary of Key Terms"),
            _task("Student Project Spotlight Release Forms", 1, 1),
            _page("Student Project Spotlight Submission Form", 1),
            _page("Important Links"),
        ]},
        {"id": "conduct", "title": "Slugworks Code of Conduct", "prerequisites": ["Welcome to Slugworks"], "items": [
            _page("Slugworks Code of Conduct"),
            _page("Slugworks Social Rules"),
            _quiz("Code of Conduct & Social Rules Quiz", 9, 1),
            _page("CARE"),
        ]},
        {"id": "safety", "title": "General Safety", "prerequisites": ["Welcome to Slugworks", "Slugworks Code of Conduct"], "items": [
            _page("Space Guidelines"),
            _quiz("Space Guidelines Quiz", 11, 1),
            _quiz("Shop Safety Quiz", 10, 1),
            _quiz("Fire Safety Training & Quiz", 6),
            _page("First Aid SOP"),
            _quiz("First Aid Quiz", 7, 1),
            _page("Situational Safety"),
            _quiz("Situational Safety Quiz", 6, 1),
            _page("Reporting Links"),
            _task("General Basement Safety Walkthrough (In-Person)", 1),
            _quiz("General Basement Safety Quiz", 17, 1),
        ]},
        {"id": "creatorspace", "title": "Creatorspace (BE-54)",
         "prerequisites": ["Welcome to Slugworks", "Slugworks Code of Conduct", "General Safety"], "items": [
            _page("Creatorspace Mission Statement (BE-54)"),
            _page("Creatorspace Machine Overview", required=False),
            _page("BE-54 Space Guidelines"),
            _quiz("BE-54 Space Guidelines Quiz", 6, 1),
            _quiz("BE-54 Safety Quiz", 9, 1),
            _quiz("Creatorspace General Agreement", 1),
        ]},
        {"id": "laser", "title": "Laser Cutter Lab (BE-49A)",
         "prerequisites": ["Welcome to Slugworks", "Slugworks Code of Conduct", "General Safety"], "items": [
            _page("Laser Cutter Lab Mission Statement (BE-49A)"),
            _page("BE-49A Space Guidelines"),
            _quiz("BE-49A Space Guidelines Quiz", 6, 1),
            _quiz("BE-49A Safety Quiz", 9, 1),
            _quiz("Laser Cutter Lab General Agreement", 1),
            _page("What is a Laser Cutter?"),
            _page("Cutting, Scoring & Engraving", 1),
            _page("Materials Explained", 1),
            _page("Designing for Laser Cutting in Lightburn", 1),
            _page("Laser Cutter SOP"),
            _quiz("Laser Cutter SOP Quiz", 26, 1),
            _page("Bonus Materials", required=False),
            _page("Laser Cutter Manual", 1, required=False),
            _page("Lightburn Explained", 1, required=False),
            _page("Troubleshooting", 1, required=False),
            _task("Laser Cutter In Person Check-In", 1),
            _task("Laser Cutter Check-Off Cheat Sheet", 10),
            _task("Laser Cutter In Person Check-Off", 1),
        ]},
        {"id": "printers", "title": "3D Printers (BE-54)", "prerequisites": ["Creatorspace (BE-54)"], "items": [
            _page("What is 3D Printing?"),
            _page("How 3D Printers Work", 1),
            _page("Materials Explained", 1),
            _page("Bambu Studio Explained", 1),
            _page("Slugworks 3D Printing Policy"),
            _quiz("Slugworks 3D Printing Policy Quiz", 10, 1),
            _page("BambuLabsX1C SOP"),
            _quiz("3D Printing SOP Quiz", 15, 1),
            _task("3D Printer In Person Check In (DSI)", 1),
            _task("3D Printer In Person Check-Off", 10),
        ]},
        {"id": "printer-cutter", "title": "Printer Cutter (BE-54)", "prerequisites": ["Creatorspace (BE-54)"], "items": [
            _page("How Printer Cutters Work", 1),
            _page("Printer Cutter Terminology", 1),
            _page("Materials Explained", 1),
            _page("Designing for the Roland BN20A", 1),
            _page("Best Designing Practices", 2, required=False),
            _page("Prepping the Printer Cutter", 1),
            _page("VersaWorks Explained", 1),
            _page("Slugworks Printer Cutter Policy", 1),
            _page("Roland BN20A SOP"),
            _quiz("Printer Cutter SOP Quiz", 12, 1),
            _task("Printer Cutter Prepress Check-In", 1),
            _quiz("Printer Cutter Prepress Check In Quiz", 15, 1),
            _task("Printer Cutter In-Person Check-Off", 1),
            _page("Bonus Materials", required=False),
            _page("Prepping For Orientation", 1, required=False),
            _page("Roland BN20A Manual", 1, required=False),
        ]},
    ],
}

#item ids are the module id plus the item's position, so "Materials Explained" in two modules stay separate
for _module in SLUGWORKS_COURSE["modules"]:
    for _i, _item in enumerate(_module["items"]):
        _item["id"] = f"{_module['id']}-{_i}"


def course_items() -> dict:
    return {item["id"]: {**item, "module": module["title"]}
            for module in SLUGWORKS_COURSE["modules"] for item in module["items"]}
