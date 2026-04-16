# Home-screen widgets

Four widget families ship in Phase 19D:

| Widget                | Size   | Source                                             |
|-----------------------|--------|----------------------------------------------------|
| Chat quick-type       | small  | `widgets/ios/OpenHipp0Widgets.swift` → `ChatWidget` |
| Agent status          | small  | `... → AgentStatusWidget`                          |
| Today / week / month cost | small | `... → CostWidget`                              |
| Next automation       | medium | `... → NextAutomationWidget`                      |

Android counterparts live in `packages/mobile/widgets/android/OpenHipp0Widgets.kt`.

## Data flow

```
Server       /api/widgets            ──► RemoteWidgetPayload
Mobile app   refreshWidgets(api,store) ──► toSnapshot() ──► WidgetStore.write()
iOS          FileManager(appGroup) → widgets.json
Android      SharedPreferences("openhipp0_widgets").snapshot
Widget code  reads JSON, renders via WidgetKit / RemoteViews
```

`refreshWidgets()` is called on:

- App open (after pairing load)
- Foreground push with `kind === "refresh-widgets"`
- Explicit user refresh (settings → widgets)

## Building

The Expo config plugin at `packages/mobile/plugins/with-widgets.js` scaffolds the native sources into `ios/` + `android/` during `expo prebuild`. The plugin:

1. Sets the App Group `group.com.openhipp0.mobile` in the iOS entitlements (so app + widget share storage).
2. Copies `widgets/ios/*.swift` into `ios/OpenHipp0Widgets/` along with the extension `Info.plist`.
3. Copies `widgets/android/OpenHipp0Widgets.kt` into the main app module and emits layout + widget-info XMLs.
4. Registers the AppWidget providers in `AndroidManifest.xml`.

The widget extension **Xcode target** still has to be added manually once per fresh prebuild (Xcode → File → New → Target → Widget Extension, point at `OpenHipp0Widgets/`) — automating this requires the `xcode` npm lib and is tracked as a follow-up. All other wiring is fully automated.

## Palette + typography

Widgets mirror the mobile theme tokens directly so nothing drifts:

- `#FAF9F5` background (light only — widgets don't auto-switch themes on iOS 17)
- `#131314` primary text, `#72706B` secondary, `#4B4A45` tertiary
- `#D97757` accent (CTA + pending-approval count)
- `#E8E6DC` border (unused on current small layouts, kept for consistency)
- System font, 13/14/17/22pt weights mirroring the app's `typography.caption / bodySm / h3 / h1`

Keep changes to tokens in lock-step between `src/theme/colors.ts` and the `Hippo*` constants in the Swift + Kotlin files.
