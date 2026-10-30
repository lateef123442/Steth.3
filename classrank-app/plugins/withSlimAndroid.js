// Makes the Android APK much smaller without removing any feature:
//  1. Builds only for real phones (32-bit and 64-bit ARM) and skips the emulator/Intel versions (x86, x86_64).
//     Every normal Android phone still works.
//  2. Compresses the native libraries inside the APK. They are unpacked on the phone when it installs, so the
//     downloaded file is far smaller (the app takes about the same room once installed).
//  3. Compresses the JavaScript bundle inside the APK too.
const { withGradleProperties } = require("@expo/config-plugins");

const SETTINGS = {
  reactNativeArchitectures: "armeabi-v7a,arm64-v8a",
  "expo.useLegacyPackaging": "true",
  "android.enableBundleCompression": "true",
};

module.exports = function withSlimAndroid(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    for (const [key, value] of Object.entries(SETTINGS)) {
      const existing = props.find((p) => p.type === "property" && p.key === key);
      if (existing) existing.value = value;
      else props.push({ type: "property", key, value });
    }
    return cfg;
  });
};
