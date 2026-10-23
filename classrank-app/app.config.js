// Extends app.json. Android push notifications need Google's Firebase file (google-services.json).
// It is used automatically when it exists in this folder (or when the EAS file variable GOOGLE_SERVICES_JSON is set),
// and builds keep working without it until Firebase has been set up.
const fs = require("fs");

module.exports = ({ config }) => {
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync("./google-services.json") ? "./google-services.json" : null);
  if (!file) return config;
  return { ...config, android: { ...config.android, googleServicesFile: file } };
};
