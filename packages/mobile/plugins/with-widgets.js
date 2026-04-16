// packages/mobile/plugins/with-widgets.js
//
// Expo config plugin that scaffolds the native WidgetKit + AppWidget code
// into ios/ + android/ during `expo prebuild`. We intentionally stay
// declarative: the plugin only copies source files + registers manifest
// entries; the actual widget logic lives in the checked-in Swift + Kotlin.
//
// Inputs (from packages/mobile/app.json -> expo.plugins):
//   ["./plugins/with-widgets"]
//
// Outputs:
//   ios/OpenHipp0Widgets/  — WidgetKit extension target, SwiftUI source, Info.plist
//   android/app/src/main/java/com/openhipp0/mobile/widgets/  — Kotlin sources
//   android/app/src/main/res/layout/widget_*.xml             — widget layouts
//   android/app/src/main/res/xml/appwidget_info_*.xml        — AppWidget metadata
//   AndroidManifest.xml receivers wired
//
// This plugin is intentionally small. Anything complex (entitlements, code
// signing, schema migrations) is handled by EAS at build time, not here.

const fs = require("node:fs");
const path = require("node:path");
const {
  withInfoPlist,
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require("@expo/config-plugins");

const WIDGET_SRC_DIR = path.resolve(__dirname, "..", "widgets");
const APP_GROUP = "group.com.openhipp0.mobile";
const ANDROID_PROVIDERS = [
  "ChatWidgetProvider",
  "AgentStatusWidgetProvider",
  "CostWidgetProvider",
  "NextAutomationWidgetProvider",
];

function copyRecursive(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyRecursive(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function withIosWidgets(config) {
  config = withInfoPlist(config, (cfg) => {
    // Register the App Group so both app + widget read/write the shared file.
    cfg.modResults["com.apple.security.application-groups"] = [APP_GROUP];
    return cfg;
  });

  config = withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const targetDir = path.join(cfg.modRequest.platformProjectRoot, "OpenHipp0Widgets");
      copyRecursive(path.join(WIDGET_SRC_DIR, "ios"), targetDir);
      // Info.plist for the extension
      fs.writeFileSync(
        path.join(targetDir, "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>Open Hipp0 Widgets</string>
  <key>CFBundleIdentifier</key><string>com.openhipp0.mobile.widgets</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string>
  </dict>
</dict></plist>
`,
      );
      // NOTE: wiring the extension target into the .xcodeproj requires
      // `xcode` npm lib; that happens in production via `eas prebuild`. Here
      // we scaffold the files and leave the target registration to the
      // operator (documented in docs/mobile-install.md).
      return cfg;
    },
  ]);

  return config;
}

function withAndroidWidgets(config) {
  // Copy Kotlin sources + resource files.
  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const main = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main");
      const ktDst = path.join(main, "java", "com", "openhipp0", "mobile", "widgets");
      const layoutDst = path.join(main, "res", "layout");
      const xmlDst = path.join(main, "res", "xml");
      fs.mkdirSync(ktDst, { recursive: true });
      fs.mkdirSync(layoutDst, { recursive: true });
      fs.mkdirSync(xmlDst, { recursive: true });

      // Kotlin source
      fs.copyFileSync(
        path.join(WIDGET_SRC_DIR, "android", "OpenHipp0Widgets.kt"),
        path.join(ktDst, "OpenHipp0Widgets.kt"),
      );

      // Layouts — one minimal layout per widget
      const layouts = {
        widget_chat: ["widget_title", "widget_cta"],
        widget_agent_status: ["widget_title", "widget_status", "widget_pending"],
        widget_cost: ["widget_label", "widget_today", "widget_subline"],
        widget_next_automation: ["widget_title", "widget_name", "widget_when"],
      };
      for (const [name, fields] of Object.entries(layouts)) {
        const textViews = fields
          .map((id) => `  <TextView android:id="@+id/${id}" android:layout_width="wrap_content" android:layout_height="wrap_content" android:textSize="14sp" />`)
          .join("\n");
        fs.writeFileSync(
          path.join(layoutDst, `${name}.xml`),
          `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/widget_root"
    android:orientation="vertical"
    android:padding="12dp"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
${textViews}
</LinearLayout>
`,
        );
      }

      // AppWidget metadata
      const infos = {
        appwidget_info_chat: { minWidth: 110, minHeight: 110, layout: "widget_chat" },
        appwidget_info_agent_status: { minWidth: 110, minHeight: 110, layout: "widget_agent_status" },
        appwidget_info_cost: { minWidth: 110, minHeight: 110, layout: "widget_cost" },
        appwidget_info_next_automation: { minWidth: 250, minHeight: 110, layout: "widget_next_automation" },
      };
      for (const [name, info] of Object.entries(infos)) {
        fs.writeFileSync(
          path.join(xmlDst, `${name}.xml`),
          `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="${info.minWidth}dp"
    android:minHeight="${info.minHeight}dp"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/${info.layout}"
    android:widgetCategory="home_screen" />
`,
        );
      }

      return cfg;
    },
  ]);

  // Register the AppWidgetProviders in the manifest.
  config = withAndroidManifest(config, (cfg) => {
    const mainApp = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    mainApp.receiver = mainApp.receiver ?? [];
    for (const providerClass of ANDROID_PROVIDERS) {
      const existing = mainApp.receiver.find(
        (r) => r.$["android:name"] === `com.openhipp0.mobile.widgets.${providerClass}`,
      );
      if (existing) continue;
      const infoName = providerClass
        .replace(/Provider$/, "")
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        .replace(/^_/, "");
      mainApp.receiver.push({
        $: {
          "android:name": `com.openhipp0.mobile.widgets.${providerClass}`,
          "android:exported": "false",
        },
        "intent-filter": [
          { action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.appwidget.provider",
              "android:resource": `@xml/appwidget_info_${infoName}`,
            },
          },
        ],
      });
    }
    return cfg;
  });

  return config;
}

module.exports = function withWidgets(config) {
  config = withIosWidgets(config);
  config = withAndroidWidgets(config);
  return config;
};
