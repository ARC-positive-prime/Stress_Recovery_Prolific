# Data receivers: one JSON file per upload, saved in Microsoft storage

The experiment runs in the participant's browser (GitHub Pages). It cannot
write files anywhere by itself, so it **sends** each data file to a small
"receiver" — a web address that saves what it gets as a `.json` file in your
storage. No spreadsheet is involved, and each file is saved exactly as sent.

This folder holds:

| path | what |
|---|---|
| `README.md` | this guide |
| `azure_function/` | Option B: a ready-made Azure Function (receiver code) |
| `local_test_server.js` | Option C: a receiver for piloting on your own PC (separate file) |

Contents:

1. [How an upload works](#1-how-an-upload-works-the-protocol)
2. [Which option should I choose?](#2-which-option-should-i-choose)
3. [Option A: Power Automate → OneDrive / SharePoint](#3-option-a--power-automate--onedrive-for-business-or-sharepoint-primary)
4. [Option B: Azure Function → Azure Blob Storage](#4-option-b--azure-function--azure-blob-storage-fallback)
5. [Option C: local test receiver](#5-option-c--local-test-receiver-piloting-on-your-own-pc)
6. [Pilot checklist](#6-pilot-checklist-do-this-before-going-live)
7. [Downloading the data for analysis](#7-downloading-the-data-for-analysis)
8. [What was checked, and what you must test](#8-what-was-checked-and-what-you-must-test-yourself)

---

## 1. How an upload works (the protocol)

Everything the receiver needs to know:

**The browser sends**

- `POST` to the address in `js/config.js` → `DATA.UPLOAD_URL`
- header `Content-Type: text/plain;charset=utf-8`. Because the content type is
  `text/plain`, this is a CORS "simple request", so the browser sends **no
  preflight (OPTIONS) request**.
- body: the participant JSON file as text (format: `docs/DATA_FORMAT.md`).
  The JSON includes this section:

  ```json
  "upload": { "folder": "progress", "file_name": "P3K9X2QA__AB12CD34__p03_stroop-baseline.json", "seq": 3 }
  ```

**The receiver must**

- save the body **unchanged** as `<root>/<upload.folder>/<upload.file_name>`.
  `folder` is always `complete`, `progress` or `quit`.
- reply with any **2xx** status when the file is saved (body `{"ok":true}`
  recommended).
- put the header **`Access-Control-Allow-Origin: *`** on the reply. Without it
  the browser is not allowed to read the reply and counts the upload as
  failed, even though the file was saved.
- reply **409** if a file with that name already exists, and never overwrite
  it. Every upload has a new, unique file name. A name only repeats when an
  earlier try of the same upload was saved but its reply was lost, so the
  browser reads 409 as "already saved".

**When the browser uploads**

| folder | when | file name |
|---|---|---|
| `complete/` | once, at the end | `<pid>__<page_load_id>.json` |
| `progress/` | after every step (about 16 per person) | `<pid>__<page_load_id>__p<seq>_<step>.json` |
| `quit/` | when the page is closed early. A small file of 60 KB or less, sent with `fetch(..., {keepalive:true})`; its reply is never read. | `<pid>__<page_load_id>__quit_<seq>.json` |

For any reply other than 2xx or 409, or a timeout (`DATA.UPLOAD_TIMEOUT_MS`,
30 s), the browser tries again. If the final upload still fails, the
participant is offered a "Download data file" button.

---

## 2. Which option should I choose?

| | **A. Power Automate** | **B. Azure Function** | **C. Local test server** |
|---|---|---|---|
| Files end up in | your SharePoint site or OneDrive for Business (IIT Kanpur Microsoft 365) | Azure Blob Storage (download with Storage Explorer) | `receivers/received/` on your PC |
| Needs | a **Power Automate Premium** licence or trial (the HTTP trigger is a premium connector) | an Azure subscription (Azure for Students: free credit, no credit card) | Node.js on your PC |
| Coding | none (click-through) | none to write; you deploy the ready-made code | none |
| Use it for | **the real study (first choice)** | the real study, if A is not possible | piloting only |

**Rule of thumb:** ask IIT Kanpur IT whether you can get Power Automate
Premium. If yes, use A. If not, or if it takes too long, use B. Use C while
you build and pilot either way.

---

## 3. Option A — Power Automate → OneDrive for Business or SharePoint (primary)

What you will build (one flow: a trigger plus 5 steps, arranged one after
another in a single line, with no parallel branches):

```
When an HTTP request is received      (Who can trigger: Anyone; method POST; no schema)
  └─ Parse            Compose:  json(string(triggerBody()))
      └─ Create file  SharePoint or OneDrive for Business
          └─ Respond saved      Response 200  {"ok":true}           (runs if Create file succeeded)
              └─ Respond failed Response 409 if the file already    (runs if "Respond saved" was skipped
                                exists, else 500   {"ok":false}      = Create file failed)
                  └─ Mark failed Terminate, status Failed           (runs after "Respond failed", so that
                                                                     failed saves show red in run history)
```

### A0. Before you start: licence and permissions

- **The licence is a requirement.** "When an HTTP request is received" is a
  **Premium** trigger. The person who owns the flow needs a **Power Automate
  Premium** (per-user) licence, a Premium **trial**, or a Power Automate
  Process licence assigned to the flow. Microsoft 365 education licences (A1,
  A3, A5) include only standard connectors.
  - **Ask IIT Kanpur IT** whether they can give you Premium, and whether
    self-service trials are allowed in the tenant. When you add the trigger,
    Power Automate usually offers a free Premium trial (reported as 90 days,
    but your tenant's policy decides).
  - **When a trial ends, the flow stops saving data.** Make sure the trial or
    licence covers the **whole** data-collection period.
  - **Trials have a low daily action limit.** Microsoft puts "all license
    trials" (and Microsoft 365 plans) in the *Low* performance profile:
    about **10,000 actions per 24 hours**, against about 200,000 for a paid
    Power Automate Premium licence. Every upload uses about 4–5 actions and
    each participant sends about 17 uploads, so a trial handles roughly
    **100–140 participants per day**. Above that the flow is slowed down and
    uploads time out (the participant is then offered the download button).
    If you expect more per day on a trial, release the study in smaller
    batches, or set `UPLOAD_PROGRESS: false` in `js/config.js` (one upload per
    participant instead of ~17; for drop-outs you then only get the
    best-effort `quit/` file).
  - If the IT team says no, use **Option B**.
- The tenant's data-policy (DLP) rules may block the HTTP trigger, or the
  "Anyone" option for it. If saving the flow shows a policy error, or "Anyone"
  is missing, ask IT or use Option B.
- **SharePoint is better than OneDrive.** Files in a personal OneDrive belong
  to your account and are removed when the account is closed (for example,
  when you leave the institute). A SharePoint document library, such as your
  lab's Teams site, belongs to the group. Both keep **version history**.

### A1. Create the folders

Pick a root folder, for example `StressRecoveryData`, and create **three
subfolders** inside it:

```
StressRecoveryData/
   complete/
   progress/
   quit/
```

- SharePoint: open the site, then **Documents**, then **+ New → Folder**.
  The library usually appears in paths as `/Shared Documents/...`.
- OneDrive for Business: open onedrive.com (work account), then **+ Add new →
  Folder**.

Give the research team access to this folder. Ideally, only the people who
analyse the data, with **Read** permission where possible.

### A2. Create the flow and its trigger

1. Go to <https://make.powerautomate.com> and sign in with your IIT Kanpur
   Microsoft 365 account. The default environment (top right) is fine.
2. Select **+ Create**, then **Instant cloud flow**.
   - Name: `Stress recovery data receiver`
   - Trigger: **When an HTTP request is received** (search for "HTTP request"
     or "Request"), then **Create**.
   - If the trigger is not offered there, select **Skip**, then add a trigger
     and search for "When an HTTP request is received".
3. Click the trigger and set:
   - **Who can trigger the flow?** = **Anyone**. You must choose this. The
     other two options ("Any user in my tenant" / "Specific users in my
     tenant") require a Microsoft sign-in token, which participants' browsers
     do not have, so every upload would fail with 401.
   - **Request Body JSON Schema**: leave it **empty**. The body arrives as
     `text/plain`, and you will parse it yourself in the next step.
   - **Method**: **POST**. If you don't see a Method box, open **Advanced
     parameters** (or **Show all**) and pick it there.

### A3. Step "Parse" (Compose)

1. Click **+** under the trigger, then **Add an action**, then search
   **Compose** (Data Operation).
2. Rename the action to **`Parse`**: click its title, or use the `...` menu
   and **Rename**. The name matters, because the expressions below refer to
   `outputs('Parse')`.
3. Click in **Inputs**, open the **expression editor** (the *fx* icon), paste
   the following and click **Add**:

   ```
   json(string(triggerBody()))
   ```

   `triggerBody()` is the raw text that the browser sent. `string()` makes
   sure it is treated as text, and `json()` turns it into an object, so that
   `upload.folder` and `upload.file_name` can be read.

### A4. Step "Create file"

Add **one** of these two actions under *Parse*. Keep the default action name
**Create file**; the status-code expression in A6 refers to it as
`Create_file`.

Both versions use the same **File Name** expression. It takes the name the
browser sent and turns any `/` or `\` into `_`, so a hand-made request
cannot point outside your folder (the experiment itself never sends these
characters):

```
replace(replace(string(outputs('Parse')?['upload']?['file_name']), '/', '_'), '\', '_')
```

**A4-SharePoint: "Create file" (SharePoint connector)**

| field | value |
|---|---|
| Site Address | pick your site from the list |
| Folder Path | expression (below) |
| File Name | expression: the File Name expression above |
| File Content | expression: `string(triggerBody())` |

Folder Path expression (change the first part to your own root path):

```
concat('/Shared Documents/StressRecoveryData/', if(contains(createArray('complete','progress','quit'), outputs('Parse')?['upload']?['folder']), outputs('Parse')?['upload']?['folder'], 'rejected'))
```

**A4-OneDrive: "Create file" (OneDrive for Business connector)**

| field | value |
|---|---|
| Folder Path | expression: `concat('/StressRecoveryData/', if(contains(createArray('complete','progress','quit'), outputs('Parse')?['upload']?['folder']), outputs('Parse')?['upload']?['folder'], 'rejected'))` |
| File Name | expression: the File Name expression above |
| File Content | expression: `string(triggerBody())` |

Notes:

- **Use the exact root path.** Use the folder picker once on your root
  folder, look at the text it inserts (for example
  `/Shared Documents/StressRecoveryData`), then replace it with the expression
  above using exactly that text. The library name can differ, for example in a
  non-English site.
- The `if(contains(...))` part means only `complete`, `progress` and `quit`
  are used. Anything else goes to a `rejected` folder (or fails), so stray
  requests cannot scatter files around your library.
- **File Content** is the original text, unchanged. It is *not* the parsed
  object.
- **Leave the action's Settings alone**, in particular **Content transfer →
  Allow chunking** (on by default). Community reports say that switching
  chunking off makes SharePoint's *Create file* overwrite existing files
  instead of refusing them, which would break the "never overwrite" rule.

### A5. Step "Respond saved" (Response, status 200)

1. Click **+** under *Create file*, then **Add an action**, then search
   **Response** (the built-in "Request" group). Rename it to **`Respond saved`**.
2. Set:
   - **Status Code:** `200`
   - **Headers** (two rows):

     | key | value |
     |---|---|
     | `Access-Control-Allow-Origin` | `*` |
     | `Content-Type` | `application/json` |

   - **Body:** `{"ok":true}`
3. In its settings, leave **Asynchronous response** **Off** (the default).
4. **Run after** stays at the default: *Create file* **is successful**.

### A6. Step "Respond failed" (Response, status 409 or 500)

1. Click **+** under *Respond saved* (in the same line, **not** as a parallel
   branch; Microsoft documents that Response actions aren't supported inside
   parallel branches), then add another **Response**. Rename it to
   **`Respond failed`**.
2. Set:
   - **Status Code:** click in the box, open the **expression editor** (*fx*),
     paste the following and click **Add**:

     ```
     if(contains(toLower(string(outputs('Create_file'))), 'already exist'), 409, 500)
     ```

   - **Headers:** the same two rows as above
     (`Access-Control-Allow-Origin: *`, `Content-Type: application/json`).
   - **Body:** `{"ok":false}`
3. Open its **Settings**, then **Run after**. For *Respond saved*, tick **is
   skipped** only, and untick *is successful*.
   - When *Create file* fails, *Respond saved* is skipped, so this step runs.
   - When *Create file* succeeds, *Respond saved* runs, so this step is
     skipped.

**Why 409 for "already exists" and 500 for everything else.** The browser
treats 409 as "already saved". That is right when *Create file* failed
because the file already exists: a retry of an upload whose reply was lost
(SharePoint then says "A file with the name … already exists"). For any
other failure (a wrong folder path, an expired SharePoint/OneDrive
connection, throttling, an outage) the expression answers **500**, so the
browser tries again and, at the end of the study, offers the participant the
**Download data file** button. A plain `409` here would make the browser
believe those failed saves worked, and nobody would notice.

- The expression needs the action to be named *Create file* (internally
  `Create_file`).
- **Fallback:** if the designer refuses the expression, or pilot test 1
  (section 6) gives **500** instead of 409 on the second run, type a plain
  `409` instead. You then rely on the run history (below) to catch failed
  saves, so check it regularly during data collection.
- **The run history keeps the data.** Every run stores the full request (the
  participant file) for **30 days**. Open a failed run, click the trigger,
  and copy the body out.

### A6b. Step "Mark failed" (Terminate)

Without this step a failed save still shows as a green "Succeeded" run,
because the run's last step (*Respond failed*) succeeded.

1. Click **+** under *Respond failed*, then **Add an action**, then search
   **Terminate** (Control). Rename it to **`Mark failed`**.
2. Set **Status** to **Failed**. Code and message are optional, for example
   message `Create file failed - see the Create file step`.
3. **Run after** stays at the default: *Respond failed* **is successful**.
   When the save works, *Respond failed* is skipped, so this step is skipped
   too.

Failed saves, including the deliberate duplicate in pilot test 1, now show
as **Failed** in the run history, and Power Automate may e-mail you about
failing runs.

### A7. Save and copy the URL into the experiment

1. Click **Save**. The trigger now shows **HTTP URL**. Copy it with the copy
   icon. It looks like this:

   ```
   https://<…>.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/<…>/triggers/manual/paths/invoke?api-version=1&sp=…&sv=1.0&sig=<secret>
   ```

   Microsoft moved these URLs from `…logic.azure.com…` to
   `…environment.api.powerplatform.com…` in 2025, and old `logic.azure.com`
   URLs were retired on 30 Nov 2025. Always copy the URL shown in **your**
   trigger after saving, and ignore older tutorials. If you copy the flow
   ("Save As") or import it elsewhere, it gets a **new** URL.

2. Paste it into `js/config.js`:

   ```js
   DATA: {
     UPLOAD_URL: "https://…environment.api.powerplatform.com…&sig=…",   // ← here
     ...
   },
   ```

3. Commit and push, so that GitHub Pages serves the new `config.js`. Then run
   the pilot checklist (section 6).

### A8. Security

- **The URL is the key.** The `sig=` part of the URL is the only secret: with
  "Anyone", whoever has the full URL can send files to the flow.
- **It is write-only.** The URL can only **add** files to your three folders
  (and `rejected/`). It cannot read, list or delete anything. With
  **SharePoint** it cannot change existing files either, because *Create
  file* refuses an existing name. With **OneDrive** this is not guaranteed:
  OneDrive's *Create file* may overwrite a file of the same name (see
  section 8), so someone who has the URL **and** guesses a participant's
  exact file name could replace it. Version history still keeps the
  original. This is one more reason to prefer SharePoint.
- **The URL is visible in your public study page.** It necessarily appears in
  the page's `config.js`, which any participant could look at, and this is
  unavoidable for browser uploads. The worst anyone can do with it is add junk
  files.
- **Don't spread it further.** Don't post it in forums, screenshots, papers or
  preregistrations.
- **If it is abused,** create a new URL and update `config.js`. Either use
  "Save As" to make a copy of the flow, or regenerate the key
  (<https://learn.microsoft.com/en-us/power-automate/regenerate-sas-key>).
- **Version history shows edits.** SharePoint libraries and OneDrive keep
  version history. In SharePoint the receiver never overwrites, so a data
  file with more than one version means someone edited it by hand. You can
  see who did it, when, and restore the original (**…** then **Version
  history**). In OneDrive a second version can also come from a retried
  upload; it then has identical content.
- **Run history is an audit log.** It shows every upload for 30 days. It
  also holds a copy of every participant file for those 30 days, so share
  the flow only with people who may see the data.

### A9. Troubleshooting Option A

| symptom | likely cause / fix |
|---|---|
| 401 / "unauthorized" | "Who can trigger the flow" is not **Anyone**, or the URL was copied incompletely (the `&sig=…` part is missing). |
| 502 Bad Gateway | No Response step answered. Check that the two Responses are in **one line**, that the *Run after* settings match A5/A6, and that the Status Code expression in *Respond failed* is exactly as in A6. (A hand-made body that is not valid JSON makes *Parse* fail; *Respond failed* then answers 500, or the caller gets 502 if its expression cannot be evaluated. Either way the browser retries, which is fine.) |
| Every upload gets 500; *Create file* (or *Parse*) fails | Open the run, then the trigger's **outputs**. If the body looks like `{"$content-type": "...", "$content": "eyJ..."}` instead of the JSON text, change both `string(triggerBody())` (in *Parse* and in *File Content*) to `base64ToString(triggerBody()?['$content'])`. Microsoft documents that `text/plain` bodies are kept raw, so this should not happen. Otherwise read the error of *Create file* (wrong folder path, expired connection, …). |
| Pilot test 1: the **second** run gives **500**, not 409 | Open that run and read the error of *Create file*. If it is a "file already exists" message in other words, replace `'already exist'` in the A6 expression with a lower-case piece of that message, or use the plain-`409` fallback (A6). If the second run gives **200**, *Create file* overwrote the file (possible with OneDrive, see section 8); nothing is lost, because a retry sends identical content. |
| Uploads are slow, time out, or get 429 | The flow is being throttled. Trials have a low daily action limit (A0). |
| Files appear in `rejected/` | `upload.folder` was not complete / progress / quit (only possible for hand-made test requests). |
| Browser console: "blocked by CORS policy", "Failed to fetch", or "multiple values '*, *'" | Check the `Access-Control-Allow-Origin` header row in **both** Responses. If the error says *multiple values*, the platform already adds the header, so remove the row from both Responses. |
| `ok:false` uploads keep retrying | The *Respond saved* body must be exactly `{"ok":true}`. |

---

## 4. Option B — Azure Function → Azure Blob Storage (fallback)

What you will build: an **Azure Function** (the ready-made code in
`receivers/azure_function/`) that saves each upload into a **Blob Storage
container** named `participant-data`, under `complete/`, `progress/` and
`quit/`. It never overwrites: if a file already exists it answers 409.

### B0. Account and cost

- **Azure for Students** (<https://azure.microsoft.com/free/students>) gives
  free credit, renewable yearly, with **no credit card**, using your
  university e-mail. It is only for **enrolled students**.
- Staff can ask IIT Kanpur IT for a university Azure subscription, or use
  Pay-As-You-Go.
- **Cost:** this study (a few thousand small uploads and a few hundred MB of
  files) fits within the Functions free monthly grant, and storage costs
  cents per month. Check <https://azure.microsoft.com/pricing/details/functions/>
  if you want numbers.

### B1. Create the storage account and the container (Azure Portal)

1. In <https://portal.azure.com>, go to **Create a resource**, then **Storage
   account**, then **Create**.
   - Resource group: **Create new**, for example `stress-recovery-rg`.
   - Storage account name: lowercase letters and digits only, for example
     `stressrecoverydata01`.
   - Region: a region near you, for example **Central India**. Use the
     **same** region for the Function App.
   - Primary service: *Azure Blob Storage or Azure Data Lake Storage Gen 2*.
     Performance: **Standard**. Redundancy: **LRS**, the cheapest (**ZRS** is
     safer).
   - On the **Advanced** tab:
     - Turn **off** "Allow enabling anonymous access on individual containers".
     - Keep **"Enable storage account key access" on**, because the function
       uses a key-based connection string.
2. Select **Review + create**, then **Create**, then **Go to resource**.
3. Go to **Data storage**, then **Containers**, then **+ Container**. Name it
   `participant-data`, set the access level to **Private**, and select
   **Create**. The function also creates it if it is missing.
4. Go to **Security + networking**, then **Access keys**, then **Show** next
   to *Connection string* (key1), and **copy** it. It starts with
   `DefaultEndpointsProtocol=https;AccountName=…`. You need it in B4. **Keep
   it private:** it gives full access to the data.
5. *Optional (recommended):* under **Data management**, then **Data
   protection**, turn on **soft delete for blobs** and **versioning for
   blobs**, so that accidental deletes or changes can be undone. For strict
   tamper-proofing you can add a time-based retention (immutability) policy
   to the container. Read Microsoft's documentation before **locking** it,
   because locked files, including pilot files, cannot be deleted until the
   period ends.

### B2. Create the Function App (Azure Portal)

1. Go to **Create a resource**, then **Function App**, then **Create**, and
   choose the hosting plan **Flex Consumption**. This is Microsoft's
   recommended serverless plan; you pay per use and it scales to zero.
   - If Flex Consumption is not offered in your region or subscription,
     choose **Consumption**, the classic plan, on **Windows**. The code works
     the same way.
2. **Basics:**
   - Resource group: the same as above.
   - Function App name: for example `stress-recovery-receiver-<initials>`.
   - Region: the same as the storage account.
   - Runtime stack: **Node.js**.
   - Version: **24 LTS** (or **22 LTS**). Node 20 is no longer offered for new
     apps.
   - Instance size (Flex): **512 MB**, the smallest, is plenty.
3. **Storage:** keep the default. The app makes its own small internal
   storage account; your data goes to the one from B1.
4. **Monitoring:** keep Application Insights **on**, so that you can see logs.
5. Select **Review + create**, then **Create**.

### B3. Deploy the code (VS Code, about 10 minutes)

1. Install **Node.js LTS** (<https://nodejs.org>), **VS Code**
   (<https://code.visualstudio.com>), and in VS Code the extensions **Azure
   Functions** and **Azure Resources**. Sign in to Azure in the Azure side bar.
2. In VS Code, use **File → Open Folder…** to open
   `stress_recovery_prolific/receivers/azure_function`. Open it on its own,
   not the whole project.
3. Go to **Terminal → New Terminal** and run:

   ```
   npm install
   ```

   This downloads the two libraries named in `package.json`.
4. Press **F1**, run **Azure Functions: Deploy to Function App…**, pick the
   app from B2, and confirm. Wait for "Deployment … completed".
   - Alternative, without VS Code: install the Azure Functions Core Tools and
     the Azure CLI, run `az login`, then in this folder run
     `func azure functionapp publish <your-function-app-name>`.

### B4. Settings: tell the function where to save

In the Portal, open the Function App, then **Settings → Environment
variables**, then **App settings**, then **+ Add**:

| Name | Value |
|---|---|
| `DATA_STORAGE_CONNECTION` | the connection string from B1 step 4 |
| `CONTAINER_NAME` | *(optional)* `participant-data` is the default |

Select **Apply**, then **Confirm**. The app restarts.

If you leave `DATA_STORAGE_CONNECTION` out, the function tries the app's own
`AzureWebJobsStorage`. Newer apps often use a managed identity there instead
of a connection string, and the function then answers 500 (see the log). Set
`DATA_STORAGE_CONNECTION`.

### B5. CORS (which websites may read the reply) — required

Open the Function App, then **API → CORS**, then **Allowed Origins**, and add:

- `https://<your-github-username>.github.io`. This is the origin only: no
  repository path and no trailing slash.
- While piloting from your own PC, also add the local address you use, for
  example `http://localhost:8000`. Alternatively, add `*`, which allows every
  site.

Then select **Save**.

- **Do not skip this step.** As soon as this list has any entry (new apps
  may already list `https://portal.azure.com`), Azure handles CORS itself and
  the `Access-Control-Allow-Origin: *` that the code sends has no effect.
  Microsoft: "App Service CORS takes precedence and your own CORS code has no
  effect". A site that is not in the list then gets no CORS header, and the
  browser counts every upload from it as failed, even though the file was
  saved.
- With your github.io address in the list, the reply header is that address
  instead of `*`. Both are fine.
- CORS does **not** protect your data. It only decides whether a browser may
  *read* the reply. The protection is the `?code=` key, so `*` is acceptable.

### B6. Copy the function URL into the experiment

1. In the Function App, open **Overview**, then the **Functions** list, then
   **save**, then **Get function URL**. Choose **default (Function key)** and
   copy it. It looks like:

   ```
   https://stress-recovery-receiver-xx-<random>.<region>-01.azurewebsites.net/api/save?code=<key>
   ```

2. Paste it into `js/config.js`, then `DATA.UPLOAD_URL`, and push to GitHub.
3. The `code=` key works like the Power Automate `sig=` (A8): it is
   write-only and visible in your public page, and you can renew it under
   **App keys** or **Function keys**. Never publish the storage **connection
   string** or the storage account keys.

### B7. Logs and troubleshooting

- **Logs:** open the Function App, then **save**, then **Invocations** or
  **Logs** (Application Insights). Each upload logs `Saved <folder>/<file>
  (<bytes> bytes)`, or the reason for a 400, 409 or 500. Participant data are
  never logged.
- **401:** the URL is missing `?code=…`, or the key is wrong.
- **404:** the deployment did not finish, or the URL path is not `/api/save`.
- **500 "No storage connection string":** complete B4.
- **500 storage_error:** check that the connection string is complete and
  that "storage account key access" is enabled (Storage account →
  **Configuration**).
- **Browser "blocked by CORS policy":** see B5.
- **Changing the code:** the receiver code is in
  `azure_function/src/functions/save.js`. The size limit, allowed folders and
  file-name rule are in its `── EDIT HERE ──` block. Deploy again after an
  edit (B3, step 4). Before deploying, `npm run check` (in the
  `azure_function` folder) catches typos in the file.

### B8. Downloading the files from Blob Storage

- **Azure Storage Explorer** (free desktop app, easiest): download it from
  <https://azure.microsoft.com/products/storage/storage-explorer> and sign
  in. Open your storage account, then **Blob Containers**, then
  `participant-data`. Select the `complete` folder and choose **Download**.
- **AzCopy** (command line, good for repeated downloads):
  1. In the Portal, open the container, then **Shared access tokens**, set the
     permissions to **Read + List** with a short expiry, then **Generate SAS
     token and URL**, and copy the *Blob SAS URL*.
  2. Run:

     ```
     azcopy copy "<Blob SAS URL>" "C:\StudyData" --recursive
     ```

- **Portal:** open the container, then **Storage browser** or the container
  view, select files, and **Download**. This is fine for a few files.

---

## 5. Option C — local test receiver (piloting on your own PC)

`receivers/local_test_server.js` is a tiny receiver that runs on your own
computer. It follows the same protocol: it saves files, answers 409 for
duplicates, and sends the CORS header.

1. Install Node.js LTS (<https://nodejs.org>).
2. In a terminal in the project folder, run:

   ```
   node receivers/local_test_server.js
   ```

   Leave the window open.
3. While piloting, set this in `js/config.js`:

   ```js
   UPLOAD_URL: "http://localhost:8787/upload",
   ```

4. Open the study **from your own PC**. The test server also serves the
   study pages, so open `http://localhost:8787/index.html?quick=1` (or
   `http://localhost:8787/debug.html` and tick "Upload"; the comment at the
   top of `local_test_server.js` lists more options), and finish or abandon
   the run.
5. Files appear in `receivers/received/complete/`, `…/progress/` and
   `…/quit/`.

Before you go live, set `UPLOAD_URL` back to the real Option A or B URL.
`localhost` means "this computer", so it would not work for participants.

---

## 6. Pilot checklist (do this before going live)

Work through these with the **real** receiver URL (A or B).

- [ ] **1. Send a test file from PowerShell.** Paste your URL, then run this
  **twice**. The first run should print a small table with `True` under
  `ok`. The second should fail with **(409) Conflict**, which proves
  duplicates are refused and not overwritten.
  - **(500) Internal Server Error** on the second run: see A9 (Option A).
  - With **OneDrive** the second run may print `True` again, which means
    OneDrive overwrote the file (see section 8). Nothing is lost.

  ```powershell
  $url  = "PASTE-YOUR-UPLOAD-URL-HERE"
  $body = '{"upload":{"folder":"progress","file_name":"TEST__00000000__p00_receiver-test.json","seq":0},"status":"test","note":"cafe café ✓ परीक्षण"}'
  Invoke-RestMethod -Uri $url -Method Post -ContentType "text/plain;charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
  ```

  Then check that `progress/TEST__00000000__p00_receiver-test.json` exists,
  open it, and confirm that the accents and the Hindi word look right (UTF-8
  kept intact).

- [ ] **2. Check the CORS header.** Run the following in the same PowerShell
  window, so that `$url` is still set. Put your own GitHub Pages address in
  the first line (origin only: no repository path, no trailing slash), so
  that the request looks like one from your study page.
  - It should print `200` and then `*` (Option B may print your github.io
    address instead of `*`; that is fine too).
  - If it prints `*,*` (two values), the header is sent twice (see A9).
  - If the second line is empty, the reply has no CORS header (see A5/A6, or
    B5).

  ```powershell
  $origin = "https://YOUR-GITHUB-USERNAME.github.io"
  $body2 = '{"upload":{"folder":"progress","file_name":"TEST__00000000__p00_header-test.json","seq":0},"status":"test"}'
  $r = Invoke-WebRequest -Uri $url -Method Post -UseBasicParsing -Headers @{Origin=$origin} -ContentType "text/plain;charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body2))
  $r.StatusCode; $r.Headers["Access-Control-Allow-Origin"]
  ```

- [ ] **3. Check that a real browser can read the reply.** Open your study
  page on GitHub Pages, press **F12**, go to **Console**, paste the following
  (with your URL), and press Enter.
  - You should see `status 200 {"ok":true}` (Option B shows a few more
    fields after `"ok":true`). Running it a second time shows `status 409`.
  - If you see `FAILED: TypeError: Failed to fetch` or a CORS error in red,
    but the file was still saved, the CORS header is the problem (see A9 or
    B5).
  - The snippet prints the reply body, not the header: browsers do not let
    page scripts read `Access-Control-Allow-Origin`, so the header itself
    can only be checked with test 2.

  ```js
  fetch("PASTE-YOUR-UPLOAD-URL-HERE", {method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"},
    body: JSON.stringify({upload: {folder: "progress", file_name: "TEST__browser0__p00_cors-test.json", seq: 0}, status: "test"})})
    .then(async r => console.log("status", r.status, await r.text()))
    .catch(e => console.error("FAILED:", e));
  ```

- [ ] **4. Do a full quick run.** Open
  `https://<you>.github.io/<repo>/?PROLIFIC_PID=PILOT01&quick=1` and go
  through to the end. Then check:
  - `complete/` has `PILOT01__<code>.json`
  - `progress/` has about 16 `PILOT01__<code>__pNN_<step>.json` files
  - the last screen said the data were saved

  `quick=1` alone still uploads. Debug mode (`debug=1`) does **not** upload
  unless you add `&upload=1` to the address. See the comments at the top of
  `js/debug.js`.
- [ ] **5. Do a drop-out run.** Start `?PROLIFIC_PID=PILOT02&quick=1`, get
  past consent and one task, then **close the tab**. A small
  `quit/PILOT02__<code>__quit_N.json` should appear, plus the `progress/`
  files up to that point. Closing uploads are "best effort": try it in Chrome
  and in Firefox or Edge.
- [ ] **6. Open the complete JSON** in a text editor or browser. Check
  `"status": "complete"`, `"upload": {"folder": "complete", …}`,
  `participant.image_condition`, and that the `integrity` and `data` sections
  are filled.
- [ ] **7. Check the receiver's own log.** For Power Automate, every run in
  the flow's **Run history** should be green (Succeeded), apart from the
  deliberate duplicate tests, which show **Failed** at *Mark failed* (A6b).
  For Azure, the function's **Invocations** should show no errors; the
  duplicate tests appear as "Already saved".
- [ ] **8. Run the analysis on the pilot data** (section 7) with
  `--include-quick`, so that you know the pipeline works.
- [ ] **9. Clean up before launch.** Move the `TEST__*` and `PILOT*` files
  into a separate `pilot/` folder, or delete them. Then set the Prolific
  completion code, `RESEARCHER_CONTACT` and the final `UPLOAD_URL` in
  `js/config.js`.
- [ ] **10. Confirm the licence period.** For Option A, make sure the
  Premium licence or trial runs until the **end** of data collection.

---

## 7. Downloading the data for analysis

**Get the files**

- **SharePoint:** open the library and click **Sync** to get the folder in
  File Explorer through the OneDrive app, or select the `complete` folder and
  choose **Download** (you get a .zip).
  - Treat the synced folder as **read-only**: copy the files to a separate
    analysis folder before you open or process them, so that nothing edits
    the originals.
- **OneDrive for Business:** do the same in the OneDrive web page or the
  OneDrive app.
- **Azure Blob Storage:** see B8.
- **Local test server:** the files are already in `receivers/received/`.

**Analyse**

- `complete/` holds **one file per participant who finished**. Run the
  analysis on that folder:

  ```
  python analysis/analyze.py "C:\StudyData\complete"
  ```

  Add `--include-quick` for `?quick=1` pilot runs. See the top of
  `analysis/analyze.py` for all options.
- **Drop-outs:** run `analyze.py` on the whole data folder (all three
  subfolders) with `--include-incomplete`. Per session it takes the sections
  from the newest file but each table from the file with the most rows, because
  `quit/` files may have dropped tables (see `docs/DATA_FORMAT.md`).
- **progress/ files:** once a participant's `complete/` file exists, their
  `progress/` files are redundant. Keep them until the study is finished,
  then archive or delete them.

---

## 8. What was checked, and what you must test yourself

Checked against Microsoft documentation in November 2026:

| fact used in this guide | source |
|---|---|
| The HTTP trigger has three "Who can trigger the flow?" options: *Any user in my tenant*, *Specific users in my tenant*, *Anyone*. "Anyone" is the open (legacy) mode, where possession of the URL is enough. | <https://learn.microsoft.com/en-us/power-automate/oauth-authentication> (updated Oct 2026) |
| The `sig=` part of the trigger URL is the SAS key and can be regenerated. | <https://learn.microsoft.com/en-us/power-automate/regenerate-sas-key> |
| HTTP trigger URLs moved from `logic.azure.com` to `*.environment.api.powerplatform.com`, and the old URLs were retired on 30 Nov 2025. | <https://learn.microsoft.com/en-us/answers/questions/5616429/power-automate-http-triggers-url-domain-change>, <https://blog.topedia.com/2025/10/http-and-teams-webhook-trigger-urls-must-be-updated-in-power-automate-and-copilot-studio-agent-flows/> |
| `text/plain` request bodies are kept raw; `string(triggerBody())` gives the text, and `json()` parses a string body. | <https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-content-type> (same engine as Power Automate) |
| The Response action drops only `Allow`, most `Content-*` (except Content-Type, Content-Encoding, Content-Disposition on POST), `Cookie`, `Expires`, `Last-Modified`, `Set-Cookie` and `Transfer-Encoding`, so `Access-Control-Allow-Origin` is allowed. If every Response is skipped the caller gets 502. Response actions are not supported inside parallel branches. | <https://learn.microsoft.com/en-us/azure/connectors/connectors-native-reqres> |
| Inbound request timeout is 120 s, the message size limit is 100 MB, and run history is kept for 30 days. All licence trials and Microsoft 365 plans run in the *Low* performance profile (about 10,000 actions per 24 h); Power Automate Premium is *Medium* (about 200,000). | <https://learn.microsoft.com/en-us/power-automate/limits-and-config> (updated Nov 2026) |
| If an action fails but the branch's last action succeeds, the whole run is marked by the branch's final status (so without *Mark failed* a failed save looks Succeeded). | <https://learn.microsoft.com/en-us/azure/logic-apps/error-exception-handling> |
| OneDrive "Create file" has only Folder Path, File Name and File Content (no overwrite option) and replaces disallowed characters in file names with `_`. The connector allows 100 calls per minute per connection. | <https://learn.microsoft.com/en-us/connectors/onedriveforbusiness/> |
| SharePoint "Create file" has Site Address, Folder Path ("Must start with an existing library. Add folders if needed."), File Name and File Content. The connector allows 600 calls per minute per connection. | <https://learn.microsoft.com/en-us/connectors/sharepointonline/> |
| Azure Functions Node.js v4 model: `app.http`, `request.text()`, `jsonBody`, `@azure/functions` 4.x, Node 22/24. Flex Consumption supports Node 22/24. Azure for Students has a 15-core Flex quota, which is plenty. | <https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node?pivots=nodejs-model-v4>, <https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan> |
| Azure's built-in CORS (Function App → API → CORS) overrides CORS headers sent by the code: "App Service CORS takes precedence and your own CORS code has no effect". | <https://learn.microsoft.com/en-us/azure/app-service/app-service-web-tutorial-rest-api> |
| A blob write with `If-None-Match: *` fails if the blob already exists (the REST docs list 412; the emulator returned 409 `BlobAlreadyExists`; the code treats both as "already saved"). | <https://learn.microsoft.com/en-us/rest/api/storageservices/specifying-conditional-headers-for-blob-service-operations> |
| Azure for Students: free credit, no credit card, for students. | <https://learn.microsoft.com/en-us/azure/education-hub/about-azure-for-students> |

The Azure Function code (`azure_function/src/functions/save.js`) was tested
locally (Node 22, `@azure/functions` 4.17, `@azure/storage-blob` 12.34)
with a mocked storage client and against Microsoft's storage emulator
(Azurite). The results:

- valid uploads, including the file names in `docs/DATA_FORMAT.md`, are
  saved byte-for-byte, with UTF-8 kept
- a duplicate gets 409 and the original is not changed
- a storage 409 for any other reason (for example "container being
  deleted") gets 500, so the browser retries instead of believing it was
  saved
- bad folders and file names (`..`, `/`, `\`, wrong extension, too long) get
  400, and oversize bodies get 413
- every reply carries `Access-Control-Allow-Origin: *`

In a real browser (Chrome), a reply with the header twice (`*,*`) fails with
"Failed to fetch", and page scripts cannot read the
`Access-Control-Allow-Origin` header; pilot tests 2 and 3 are written for
that.

**Not verifiable from documentation, so test these in your pilot (section 6):**

1. **Licence and trial terms for the Premium HTTP trigger** at IIT Kanpur:
   whether you can get one, and how long a trial lasts. These are tenant
   policy; ask IT.
2. **What "Create file" does when the file already exists.** Community
   reports say SharePoint refuses with "A file with the name … already
   exists" (as long as **Allow chunking** stays on). For OneDrive the reports
   conflict: some say it overwrites. Pilot test 1 shows which happens. If
   OneDrive overwrites silently, nothing is lost, because a retry sends
   identical content. You simply get 200 instead of 409.
3. **CORS from a real browser to Power Automate.** It is not documented
   whether the platform adds its own `Access-Control-Allow-Origin` header.
   Pilot tests 2 and 3 show whether one header row is right, or whether a
   duplicate appears (A9).
4. **The text/plain body.** Microsoft documents that it arrives raw. If your
   run history shows a `$content` wrapper instead, use the fix in A9.
5. **The 409/500 status-code expression** in A6: whether the designer accepts
   it in the Status Code box, and whether the duplicate error text contains
   "already exist". Pilot test 1 checks both (the second run must give 409).
6. **Whether "Anyone" is allowed in your tenant,** or blocked by a DLP policy.
7. **Closing-tab uploads** (`quit/`) are best-effort in every browser. Pilot
   test 5 shows whether they arrive. The `progress/` files are the backup.
8. **Nothing here has run on real Power Automate or real Azure yet.** The
   Azure Function was tested against the emulator only; the exact error code
   real Azure Storage returns for a duplicate (409 or 412) is handled either
   way, and pilot test 1 confirms it.
