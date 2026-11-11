# RWO Scoring v3: Setup Guide

Setup takes about 30 minutes, once. You need a Google account, a free GitHub account, and the iPads.

There are three folders here:

- **Apps Script** holds 3 files that go into a new Google Sheet: `Code.gs`, `Engine.gs`, `Viewer.html`.
- **iPad app** holds 6 files that go on GitHub: `index.html`, `engine.js`, `sw.js`, `manifest.json`, `icon-192.png`, `icon-512.png`.
- **Sheet data (paste in)** holds your Clearwater entry list (`ENTRIES.csv`, 87 boats) and schedule with lap counts (`RACE_STARTS.csv`), ready to paste.

Your old Clearwater system is not touched. This is a separate, new spreadsheet.

---

## Part A: The Google Sheet (about 10 minutes)

1. Go to **sheets.new** to make a blank Google Sheet. Name it **RWO Scoring v3**.
2. Click **Extensions > Apps Script**.
3. In the `Code.gs` file that opens, delete everything, then paste in all of **Code.gs**.
4. Click the **+** next to Files, choose **Script**, and name it `Engine`. Delete what's there and paste in all of **Engine.gs**.
5. Click **+** again, choose **HTML**, and name it `Viewer`. Delete what's there and paste in all of **Viewer.html**.
6. Click the **Save** icon.
7. Go back to the Sheet tab and reload the page. A new **RWO Scoring** menu appears after a few seconds.
8. Click **RWO Scoring > 1. Set up tabs**. Google asks for permission the first time:
   - Click **Continue** and pick your account.
   - Click **Advanced**, then **Go to (project name)**, then **Allow**.
   - Click the menu item again if it didn't run.
9. Click **RWO Scoring > 2. Turn on auto-refresh**.
10. Fill in the tabs:
    - **SETTINGS:** the event name, and your PINs separated by commas.
    - **ENTRIES:** paste Class | Boat # | Team Name, starting at row 2. Boat numbers like 03 stay as 03.
    - **RACE_STARTS:** paste Day | Race # | Start # | Laps | Class(es). Put several classes in one start separated by commas, for example `Super Vee, Modified Vee`. If classes in the same start run different lap counts, give each its own row with the same Race # and Start # (Race 3 Start 2 does this for Bracket Class 7 and Vee Limited).
    - **Easiest way to paste:** open the CSV file from the **Sheet data** folder, select everything except the header row, copy, then click cell **A2** in the tab and paste.
11. Click **Deploy > New deployment**, then the gear icon, then **Web app**.
    - Execute as: **Me**
    - Who has access: **Anyone**
    - Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`). This is the link every iPad needs.

> **When you change the code later**, use **Deploy > Manage deployments**, click the pencil icon, set Version to **New version**, then click **Deploy**. This keeps the same URL, so you don't have to update the iPads. Don't use "New deployment" again; that creates a new URL.

---

## Part B: Put the iPad app on GitHub Pages (about 10 minutes, free)

1. Go to **github.com** and sign up for a free account.
2. Click **+** (top right), then **New repository**.
   - Name: `rwo-scoring`
   - Set it to **Public** (free GitHub Pages needs this). The app code holds no data and no PINs.
   - Click **Create repository**.
3. Click **uploading an existing file**. Drag in all 6 files from the **iPad app** folder, then click **Commit changes**.
4. Go to **Settings > Pages**. Under "Branch", choose **main** and **/ (root)**, then click **Save**.
5. Wait 1 to 2 minutes and refresh. The page shows your app link, which looks like `https://YOURNAME.github.io/rwo-scoring/`.

---

## Part C: Set up each iPad (about 3 minutes each)

1. Open **Safari** and go to your GitHub app link.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. **Always open the app from the home screen icon.** That copy works with no internet.
4. In the app, go to **Settings**:
   - Paste the **Web app URL** from Part A.
   - Enter **your PIN** and a name for this iPad, for example "Brittany iPad".
   - Tap **Save and connect**. The badge at the top right should say **Synced**.
5. In the iPad's own Settings app:
   - **General > Date & Time > Set Automatically: ON.** The three iPads' clocks must agree.
   - **Display & Brightness > Auto-Lock: Never** on race days.

To practice, go to **Settings > Turn practice mode ON**. You get demo boats plus two "robot" backup iPads, so you can try every screen, including Review. Nothing is sent to the Sheet.

---

## Race day

1. **Race tab:** pick the race, then pick this iPad's job: **Main**, **Backup 1** or **Backup 2**.
2. When the flag drops, **every iPad taps START** for that start. Each start has its own clock.
3. **Tap a boat's tile as it crosses the line.**
   - The tile turns green with **TAPPED** for 30 seconds, and extra taps are ignored.
   - **Undo** on a tile removes this iPad's last tap for that boat.
4. **Red flag (Main iPad only):** tap **RED FLAG** and choose one option:
   - **Restart in running order:** enter laps left (or the new total).
   - **Restart in original order:** enter the new total.
   - **Call the race.**

   When racing resumes, tap **START** again.
5. **End race (Main iPad):** boats still out are marked LAPS DOWN.
6. **Review tab:** clear any flags. Flags appear where the main iPad missed a lap (it was filled in from a backup), only the main iPad tapped, or the iPads disagree by more than 1 second.
7. **Results tab:** tap **Make Official**. Use **Unlock** if you need to fix something later.
8. **Edit & Penalties tab:** penalties, DNS/DNF/DQ, fixing or moving or adding laps, lap count changes, and adding or removing boats.
9. **Points tab:** Working or Official standings. Ties are flagged, and **Set tie order** lets you decide them.

**If the internet drops, keep tapping.** The badge shows "Offline: N waiting" and everything sends by itself when the connection comes back. Never delete the app or clear Safari data during an event.

---

## Results for the public, Chris, and WordPress

- **Public pages** (refresh every 5 seconds). Add these endings to your Web app URL:
  - `?view=results`
  - `?view=standings`
  - `?view=qualifying`
- **WordPress:** add a **Custom HTML** block containing:
  `<iframe src="YOUR_WEB_APP_URL?view=results" style="width:100%;height:1400px;border:0"></iframe>`
  Use `?view=standings` for the points list.
- **Sheet tabs:**
  - `RESULTS_1`, `RESULTS_2` and so on: working results per race.
  - `WEB_RESULTS` and `WEB_POINTS`: official only, in a fixed layout. Use these with File > Share > Publish to web if you'd rather embed the sheet itself.
  - `STANDINGS`: working points.
  - `QUALIFYING` and `CHANGE_LOG`.
- **EVENTS** is the permanent record of every tap and change. Don't edit it. Make every fix in the app, so it's logged.

## After the event

- **RWO Scoring > Save this event to season standings** adds the official weekend totals to `SEASON_STANDINGS`.
- **RWO Scoring > Start a new event** archives everything and clears the tabs for the next race. The iPads reset by themselves.

## Built-in rules (tell Claude if any are wrong)

| Rule | How it's set now |
| --- | --- |
| APBA points | 1200 scale, all classes. Bonus = boats beaten for the weekend, added once after the class's last race. |
| UIM points | 20 point scale for Class 1, Class 2 (500), Super Cat, Super Stock. No bonus. 11th and lower get 0. |
| Small fields | 1 boat gets 3rd-place points; 2 boats start at 2nd-place points (APBA only). |
| DNS | Last-place points (last place = number of boats on ENTRIES for that class) |
| DNF | Points for the place it ends in |
| DQ | 0 |
| Boats on ENTRIES | All count as boats that can be beaten, even if they never start. |
| Running-order restart | Laps are kept, the lap in progress is dropped, and red flag time doesn't count. Finish order after the restart decides positions. |
| Called race | Each class is scored at the last lap its leader completed. |
| Two iPads both press Red Flag | Counted as one red flag |
| Minimum lap | 30 seconds |
| Same crossing | Taps within 20 seconds of each other on different iPads |
