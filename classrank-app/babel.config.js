module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4 / SDK 57: the worklets plugin replaces "react-native-reanimated/plugin".
    // babel-preset-expo already adds it when react-native-worklets is installed, so no manual plugin is needed.
  };
};
