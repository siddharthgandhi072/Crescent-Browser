# Crescent: THE browser made for life after Arc. Helping fill that crater in your search experience.

This browser takes some of the best features from the best browsers out there and adds some of its own rocket fuel to make to make it even more out of this world. 
* **Little Crescent**, like Little Arc. Links you click in other apps (Mail, Slack, Messages…) open in a small window. Click **Open in Crescent** (or press ⌘↩) to move the page into your main window. Press ⌥⌘N for a new one.
* **Archive.** Every tab you close is saved. Unpinned tabs you haven't used in 12 hours are archived automatically. The searchable **Archive** page has a sidebar button and a File menu item.
* **Easels.** Free-form boards for text, sticky notes, shapes, drawing, images, links, and captures of any part of a web page. They're in the sidebar and the File menu.
* **Spaces like Arc.** Each Space has a name, icon, color and **profile**, so logins stay separate. Spaces that share a profile share Favorites.
* **Arc-style Settings** (⌘,). A simple window with General, Profiles, Links, Appearance, Shortcuts and Advanced tabs. "All settings…" opens the full settings.
* **Arc look and keys.** The sidebar holds the address, there's a command bar on ⌘T, ⌘S hides the sidebar, and ⌃1–9 switches Spaces. There's a white pill behind the selected tab, rounded page cards, Peek on Shift+click, Boosts and split view.
* **Crescent name and icon everywhere.** That includes the Dock, Finder and the menus ("About Crescent", "Quit Crescent").


* **Passkeys.** Passkeys saved in iCloud don't work. Apple only allows that for browsers signed with a paid Apple Developer account and specially approved by Apple. Passwords, password managers and USB security keys all work.


---

## Contents

```
./
├── build.sh                       ← the one script that does everything (run on a Mac)
├── mods/
│   ├── policies.json              → Contents/Resources/distribution/policies.json
│   ├── defaults/pref/crescent-autoconfig.js → Contents/Resources/defaults/pref/
│   ├── crescent.cfg                → Contents/Resources/crescent.cfg
│   └── crescent/                  → Contents/Resources/crescent/
│       ├── chrome.manifest        ← registers chrome://crescent/
│       ├── browser.css            ← the Arc look for the browser window
│       └── content/
│           ├── Crescent.sys.mjs   ← Little Crescent, Archive, Settings, menus, sidebar buttons
│           ├── CrescentStore.sys.mjs ← saves the Archive and Easels in your profile
│           ├── archive.*          ← the Archive page
│           ├── easels.* easel.*   ← the Easels list and editor
│           └── settings.*         ← the Arc-style Settings window
├── icon/
│   ├── make_icon.py               ← draws the icon (Python + Pillow)
│   ├── AppIcon.png
│   └── AppIcon.icns               → Contents/Resources/firefox.icns
└── .github/workflows/build-crescent.yml  ← builds the DMG on GitHub's Macs
```

---

## Install the ready-made DMG

1. Open the repo on GitHub, go to **Actions**, select **"Build Crescent (Arc-style Zen) for macOS"**, and click the newest green run.
2. Under **Artifacts**, download **Crescent-dmg**. GitHub delivers it as a `.zip`; double-click it to get `Crescent.dmg`.
3. Open `Crescent.dmg` and drag **Crescent** onto **Applications**.
4. Follow **First launch** below.

### First launch

The app is signed by you, not by a registered Apple developer, so macOS blocks it the first time. Pick one of these:

* **Settings method:** Double-click Crescent and click **Done** in the warning. Then open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to "Crescent". Confirm with your password.
* **Terminal method:** Run this once:
  ```bash
  xattr -dr com.apple.quarantine /Applications/Crescent.app
  ```

### If you got `Crescent-macOS-app.zip` (the app built without a Mac)

This copy was assembled on Linux, where Apple's signing tool doesn't exist, so it still needs to be signed on your Mac:

1. Double-click the zip and drag **Crescent.app** into **Applications**.
2. Open **Terminal** and paste this one line. It removes the "downloaded from the internet" flag and signs the app for your Mac only:
   ```bash
   xattr -cr /Applications/Crescent.app && codesign --force --deep --sign - /Applications/Crescent.app
   ```
3. Open Crescent normally.

### Bring your Arc stuff over

On first launch, the welcome screen offers to import from other browsers, and **Arc is one of them**. It brings over your Spaces, pinned tabs and favorites. You can also run it later from **File → Import From Another Browser…**.

---

## Build it yourself on your Mac

You need macOS and an internet connection. `hdiutil`, `codesign` and `curl` are already on every Mac.

```bash
cd Crescent-Browser
```

```bash
./build.sh
```

The script prints each step, and the result is `dist/Crescent.dmg`. Options:

```bash
ZEN_VERSION=1.24.1b ./build.sh
```

```bash
APP_NAME="My Browser" BUNDLE_ID="com.me.mybrowser" ./build.sh
```

To change the icon, replace `icon/AppIcon.icns` with any `.icns` file. You can make one from a 1024×1024 PNG with an online converter or **Image2icon**. Or edit the colors at the top of `icon/make_icon.py` and run `python3 icon/make_icon.py` (needs `pip3 install pillow`). Then rebuild.

---

## How it works, step by step

`build.sh` does these six steps, and you could do each one by hand.

### 1. Download the official Zen app

It downloads `zen.macos-universal.dmg` from Zen's GitHub releases. This build runs on both Apple Silicon and Intel Macs.

### 2. Copy Zen.app out

```bash
hdiutil attach -nobrowse -readonly -mountpoint mnt zen.dmg
```

```bash
ditto mnt/Zen.app Crescent.app
```

```bash
hdiutil detach mnt
```

### 3. Add the mods

Firefox, which Zen is built on, has three official ways to customize a copy of the browser without recompiling it. This project uses all three.

**a) Enterprise policy: `distribution/policies.json`.** This is the mechanism companies use to manage Firefox. The file goes in `Crescent.app/Contents/Resources/distribution/`, and Firefox applies it before anything else:

* `AIControls → Default: blocked, Locked` is Firefox's master switch that blocks every AI feature.
* `GenerativeAI: Enabled false, Locked` is an older switch that's also set, to be safe.
* It also turns off telemetry and studies.
* It turns off automatic updates, because an update would replace the modified app with plain Zen. To update, rebuild instead (see below).

You can check that the policies are active by opening `about:policies` in the browser.

**b) AutoConfig: `defaults/pref/crescent-autoconfig.js` + `crescent.cfg`.** These are Firefox's "AutoConfig" files.

* The small file in `defaults/pref/` tells the browser to run `crescent.cfg` at every startup.
* `crescent.cfg` is JavaScript with full browser privileges.
  * `lockPref(...)` forces a setting and greys it out. It's used for every AI and telemetry switch.
  * `defaultPref(...)` changes only the default, so you can still change those settings in Settings or `about:config`. It's used for the Arc-like defaults.
  * It registers the `crescent/` folder as `chrome://crescent/`, loads `browser.css` into the browser window, and starts `Crescent.sys.mjs`.

**c) Crescent's own code: `crescent/content/`.** This is ordinary web code (HTML, CSS and JavaScript) running with browser privileges:

* **`Crescent.sys.mjs`** sets up every window:
  * **Archive:** it listens for closed tabs and saves each one. Every 10 minutes it closes unpinned tabs that have been unused for 12 hours. It never closes pinned tabs, Favorites, the current tab, tabs playing audio, split-view tabs, or a Peek.
  * **Little Crescent:** Firefox opens a link from another app by calling `browserDOMWindow.openURI(...)` with an "external" flag. Crescent catches that call and opens a small window instead. **Open in Crescent** moves the tab into your main window with `gBrowser.adoptTab`.
  * **Settings:** it replaces `openPreferences()`, which is what ⌘, calls, so the Crescent Settings window opens instead.
  * **Menus and buttons:** it adds the File menu items and the Archive and Easels buttons at the bottom of the sidebar.
* **`CrescentStore.sys.mjs`** saves the Archive (`crescent-archive.json`) and Easels (`crescent-easels/`) in your profile folder.
* The **pages** (`archive`, `easels`, `easel`, `settings`) are plain HTML files.
* **`browser.css`** is the Arc styling. It works like a `userChrome.css`, and each section is commented.

### 4. Rename and replace the icon

* `AppIcon.icns` is copied over `Contents/Resources/firefox.icns`.
* `/usr/libexec/PlistBuddy` edits `Contents/Info.plist` to set `CFBundleName`, `CFBundleDisplayName` and `CFBundleIdentifier`. This is the name you see in the Dock, Finder, Cmd-Tab and the menu bar.
* For the menus, the script unzips `Contents/Resources/browser/omni.ja` (Zen's packed interface files) and changes the brand name in `localization/*/branding/brand.ftl` and `chrome/*/locale/branding/brand.properties` to "Crescent". It also changes "Zen" in Zen's own text (except the Donate button, which still pays Zen), then zips the files back up. This is Mozilla's documented way to edit `omni.ja`, and the build's self-test checks that the menu says "Quit Crescent".

### 5. Re-sign

Changing any file inside an app breaks its Apple code signature, and a Mac won't run an app with a broken signature. So the script:

1. Deletes `embedded.provisionprofile`, which is tied to Zen's Apple developer account.
2. Re-signs every piece of code, innermost first, with an **ad-hoc** signature: `codesign --force --sign -`.
3. Keeps Zen's normal permissions (JIT, camera, microphone, location, USB) and drops the two that only Zen's own developer account may use:
   * `application-identifier`
   * `web-browser.public-key-credential`, which is what lets Zen use passkeys saved in iCloud Keychain/Passwords.

As a result, **passkeys stored in iCloud Keychain won't show up in Crescent.** Passwords, password-manager extensions such as 1Password and Bitwarden, and USB security keys still work.

### 6. Make the DMG

```bash
hdiutil create -volname Crescent -srcfolder staging -fs HFS+ -format UDZO Crescent.dmg
```

The `staging` folder holds `Crescent.app` and a shortcut to `/Applications`.

---

## Arc → Crescent cheat-sheet

| Arc | In Crescent (Zen) | Shortcut |
|---|---|---|
| Hide/show sidebar | Compact mode | **Cmd+S** |
| Command bar | URL bar replaces the new-tab page | **Cmd+T** / **Cmd+L** |
| Spaces | Workspaces (Spaces) | **Ctrl+1…9**, swipe with two fingers |
| Favorites (top grid) | Favorites, one set per profile | drag a tab to the top |
| Profiles | Settings → Profiles (separate logins per Space) | |
| Pinned tabs / folders | Pinned tabs + folders | **Cmd+Shift+D** pin/unpin |
| Today tabs + "Clear" | Unpinned tabs + Clear button | **Cmd+Shift+K** clear |
| Archive | Archive page (sidebar button / File → Archive) | **Cmd+Shift+T** reopen last |
| Peek | Glance | **Shift+click** a link |
| Split View | Split View | **Cmd+Alt+V** / **Cmd+Alt+H** / **Cmd+Alt+G** |
| Copy URL | Copy URL | **Cmd+Shift+C** |
| Boosts | Boosts | in the site menu next to the URL |
| Space colors / gradients | Right-click a Space → Edit theme | |
| Media controls in sidebar | Media controls in sidebar | |
| Little Arc | Little Crescent | **Cmd+Opt+N**, **Cmd+Enter** to open in Crescent |
| Easels | Easels (sidebar button / File → New Easel) | |
| Settings | Crescent Settings | **Cmd+,** |

To change any shortcut, open Settings → Shortcuts → Customize, or go to `about:keyboard`.

## Updating to a newer Zen

Auto-update is turned off so updates can't wipe the mods. To move to a new Zen version:

* **On GitHub:** go to **Actions → Build Crescent → Run workflow**. Leave "latest" in the box or type a version.
* **On your Mac:** run `./build.sh` again.

Then drag the new Crescent into Applications and choose Replace. Your tabs, logins and settings live in your profile, not in the app, so they're kept.

## Undo / uninstall

Delete `/Applications/Crescent.app`. Your profile is in `~/Library/Application Support/zen/`. The real Zen uses the same folder, but each install keeps its own profile. To delete everything, remove that folder too.

## Credits and license

The browser is [Zen](https://github.com/zen-browser/desktop) (MPL-2.0), which is built on Firefox. Crescent isn't affiliated with Zen, Mozilla or The Browser Company. The icon is original artwork.
