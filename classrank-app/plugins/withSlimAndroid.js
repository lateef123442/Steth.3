// Makes the Android APK smaller. How much is chosen by the build profile (STETH_APK_SIZE in eas.json):
//   "off"  : nothing changes (the plain, biggest APK, around 110 MB)
//   "abi"  : only builds for real phones (32-bit and 64-bit ARM) and skips the emulator/Intel versions
//   "full" : "abi" plus compressed native libraries and a compressed JavaScript bundle (smallest, around 35 MB)
// If STETH_APK_SIZE is not set, "abi" is used, because it is the gentlest saving.
const { withGradleProperties } = require("@expo/config-plugins");

const ABI = { reactNativeArchitectures: "armeabi-v7a,arm64-v8a" };
const FULL = { ...ABI, "expo.useLegacyPackaging": "true", "android.enableBundleCompression": "true" };

module.exports = function withSlimAndroid(config) {
  const mode = (process.env.STETH_APK_SIZE || "abi").toLowerCase();
  const settings = mode === "off" ? {} : mode === "full" ? FULL : ABI;
  if (Object.keys(settings).length === 0) return config;
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    for (const [key, value] of Object.entries(settings)) {
      const existing = props.find((p) => p.type === "property" && p.key === key);
      if (existing) existing.value = value;
      else props.push({ type: "property", key, value });
    }
    return cfg;
  });
};
