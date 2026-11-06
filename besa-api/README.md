# BESA-Trainer Backend

The backend is hosted using firebase functions. It uses Python FastAPI. The main objectives of the backend are to:
 * Handle large API AI requests. 
 * Handle large requests for backend such as updating everyone's progress when there a section change. 
## Alert emails

When a BESA's break ends, the backend emails "<name>, your break has ended." to that BESA, every BESA Lead, and the root account. Each person is BCC'd, so nobody sees the others' addresses. If a break is ended early from the kiosk, the email goes out right away. If the break timer runs out, the `break_end_alerts` scheduled function sends it within about a minute.

The emails are sent from a Gmail account. Setup:

1. Pick the Gmail account the emails should come from. A shared BESA account is better than a personal one.
2. Turn on 2-Step Verification for that account. App Passwords need it.
3. Create an App Password at https://myaccount.google.com/apppasswords. Google shows it as 16 letters.
4. Set both secrets. You have to do this before the next deploy, because the functions declare them:
   ```
   firebase functions:secrets:set BREAK_ALERT_GMAIL_ADDRESS
   firebase functions:secrets:set BREAK_ALERT_GMAIL_APP_PASSWORD
   ```

When a member sends hours requests from their Profile, the root account gets one email listing each time range, what was worked on, and the reason. The root admin approves or denies them in Profile under Hours Requests.

Every email goes to the address each account signs in with (from Firebase Auth).

If either secret is empty, the emails are off and nothing else is affected. A personal Gmail account can send about 500 emails a day, and each person on the BCC list (the BESA plus every Lead) counts toward that.

## Work tracking

Clock-out measures what got done instead of asking how time was split. The steps at the kiosk are: pick what you worked on, confirm what was found and fill in the rest, describe the day, then see the grade. Someone is clocked out as soon as they confirm, so an API or the AI being down never stops them leaving. If the AI fails, the `grade_pending_work` scheduled function retries every 15 minutes, up to 5 times.

Tours, events and the like can't be measured, so every clock-out also asks for a work mode. Office counts the whole visit as office tasks. Hybrid asks what percentage was office tasks, and only that share of the hours is graded. Out counts the whole visit as out of the office, so nothing is fetched or graded.

Grades are A (good enough), B (slightly suspicious) and C (very suspicious). They're on the member's Profile, and leads see everyone's on Work Review, where they can replace a grade. A measure that couldn't be checked never counts against anyone, and a project where nothing could be checked can't be marked down.

Projects live in the `tracking_projects` collection and are edited on Manage Projects, so a new project needs no code. `tracking_catalog.py` only seeds the starting set the first time. A project's `activities` are the kiosk activity names that count as working on it. Activities with no project, like Tours or Meeting, have nothing to measure and no grade.

### Setup

These four secrets must be set before the next deploy, because the functions declare them. Set any you don't have yet to `none` and that source reports "couldn't check". The Google one has to be a real token for Google to work.

```
firebase functions:secrets:set GITHUB_TRACKING_TOKEN
firebase functions:secrets:set GOOGLE_TRACKING_CLIENT_ID
firebase functions:secrets:set GOOGLE_TRACKING_CLIENT_SECRET
firebase functions:secrets:set GOOGLE_TRACKING_REFRESH_TOKEN
```

**GitHub:** create a fine-grained token with read access to Contents and Metadata on the repositories being tracked. Without it, GitHub allows only 60 lookups an hour, which a single clock-out can use up.

**Google:** everything is read through one account, ucscbesa@ucsc.edu.

1. In Google Cloud, enable the Gmail, Calendar, Sheets, Slides and Drive APIs.
2. Create an OAuth client of type Desktop app.
3. Publish the OAuth consent screen, or make it Internal if the project is in the UCSC organization. While it's in Testing, Google expires the refresh token after 7 days.
4. Run `connect_google.py` as described at the top of that file, signing in as ucscbesa@ucsc.edu, and store the token it prints.

UCSC's Google admins can block third-party apps from Gmail. If the sign-in is refused, that's the first thing to check.

Share every tracked sheet, deck and calendar with ucscbesa@ucsc.edu. List the calendar ids on Manage Projects.

### What each source can and can't see

- **Sheets and Slides** have no history of who typed what. The kiosk copies each file at clock-in (a hash per row, or each element's position and text) and compares it at clock-out. Drive's revision list says who edited the file, but it can lag by a few minutes.
- **Slides animations** aren't in the Slides API, so Outreach Slides asks for them as a number.
- **Gmail** counts everything sent from the shared account while someone was clocked in, so two people clocked in at once both see the same emails and untick what wasn't theirs.
- **The booking database** can't say who made a change, and guests make changes too. Everything changed during the visit is listed unticked for the member to claim. Guests' contact details are never stored or shown, only that they changed.
- **GitHub** only sees pushed commits, so push before clocking out. Commits match by email, GitHub username, then name, and those often differ from what we have on file, so anything unmatched from that time is grouped by account for the member to pick one. The account they pick is remembered, so its commits match by themselves after that, and it stops being offered to anyone else. Remembered accounts can be removed under Work Accounts on Profile, which also takes an email or GitHub username directly.
- **The Slugworks course** is self-reported and can be updated on a member's own device, on the kiosk's Slugworks Course tab with their School Id, or on the clock-out screen.
- **What the AI sees** is counts, commit messages, course items, screenshots and the member's own description. It doesn't get their name, email subjects, or anything about guests.

